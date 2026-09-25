import { randomUUID } from 'crypto'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import {
  ME,
  OTHERS,
  type AudioChannel,
  type Folder,
  type LiveEvent,
  type Meeting,
  type RecordingTrack,
  type ScreenSource,
  type Settings,
  type UpdateState
} from '../shared/types'
import { BUILTIN_PROMPTS, DEFAULT_SPEAKER_ID_PROMPT, loadSettings, rememberPeople, saveSettings } from './settings'
import {
  applyFinalTranscript,
  ensureSpeaker,
  isEcho,
  mergeSpeakers,
  mergeTracks,
  newSpeakerId,
  reassignSegments,
  renameSpeaker
} from './speakers'
import { applyLoginItem, claimSingleInstance, setupBackground, startHidden } from './background'
import { classify, explain, isFatalLive, isRecoverable } from './failures'
import { handleMediaRequests, registerMediaScheme } from './media'
import { registerMini } from './mini'
import * as store from './store'
import { buildMeetingDocument, suggestSpeakerNames, summarize, transcriptText } from './summarize'
import { createLiveSession, transcribeFile } from './transcription'
import type { LiveSession, RawSegment } from './transcription/types'
import { checkForUpdates, getUpdateState, initUpdater, installUpdate } from './updater'

let win: BrowserWindow | null = null
registerMediaScheme()
// Si ya hay una ventana abierta, esa instancia recibe la petición y esta se cierra.
const primary = claimSingleInstance()
if (!primary) app.quit()

interface ActiveRecording {
  meetingId: string
  sessions: Map<AudioChannel, LiveSession>
  /** "system:0" -> id de hablante estable en la reunión */
  rawToSpeaker: Map<string, string>
}
let rec: ActiveRecording | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 380,
    minHeight: 560,
    title: 'Meeting Notes',
    autoHideMenuBar: true,
    backgroundColor: '#121214',
    icon,
    // Al iniciar con Windows la app arranca en la bandeja, sin ventana.
    show: !startHidden(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // La app suele estar detrás de Teams/Meet mientras graba: que siga refrescando.
      backgroundThrottling: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

const emit = (channel: string, payload: unknown): void => win?.webContents.send(channel, payload)
const emitLive = (e: LiveEvent): void => emit('live:event', e)

/** Lee, modifica y guarda una reunión; notifica al renderer. */
function mutate(id: string, fn: (m: Meeting) => void): Meeting {
  const m = store.getMeeting(id)
  if (!m) throw new Error('Reunión no encontrada')
  fn(m)
  store.saveMeeting(m)
  emit('meeting:updated', m)
  return m
}

// ---------------- grabación ----------------

function speakerFor(r: ActiveRecording, m: Meeting, channel: AudioChannel, raw: string | null): string {
  if (channel === 'mic') return ME
  if (raw === null) return OTHERS
  const key = `${channel}:${raw}`
  let id = r.rawToSpeaker.get(key)
  if (!id) {
    id = newSpeakerId()
    r.rawToSpeaker.set(key, id)
  }
  ensureSpeaker(m, id)
  return id
}

/** Pantalla elegida para la próxima captura (id de desktopCapturer). */
let screenSourceId: string | null = null

async function listScreens(): Promise<ScreenSource[]> {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay().id
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } })
  return sources.map((s, i) => {
    const d = displays.find((x) => String(x.id) === s.display_id)
    const size = d ? ` · ${d.size.width * d.scaleFactor}×${d.size.height * d.scaleFactor}` : ''
    return {
      id: s.id,
      displayId: s.display_id,
      label: `Pantalla ${i + 1}${size}${d?.id === primary ? ' (principal)' : ''}`,
      thumbnail: s.thumbnail.toDataURL()
    }
  })
}

function startRecording(meetingId: string, channels: AudioChannel[], withScreen = false): void {
  const settings = loadSettings()
  stopLiveSessions()
  const r: ActiveRecording = { meetingId, sessions: new Map(), rawToSpeaker: new Map() }

  try {
    for (const channel of channels) {
      const session = createLiveSession(settings, channel, {
        onSegment: (raw: RawSegment) => {
          if (rec !== r) return
          mutate(meetingId, (m) => {
            // Sin auriculares el micrófono recoge a los demás: su eco no es tuyo.
            if (channel === 'mic' && isEcho(raw, m.transcript.filter((s) => s.speakerId !== ME))) return
            if (channel === 'system') {
              m.transcript = m.transcript.filter((s) => s.speakerId !== ME || s.source !== 'live' || !isEcho(s, [raw]))
            }
            const speakerId = speakerFor(r, m, channel, raw.speaker)
            const { text, start, end, lang } = raw
            m.transcript.push({ id: randomUUID(), speakerId, text, start, end, source: 'live', ...(lang && { lang }) })
            m.transcript.sort((a, b) => a.start - b.start)
          })
        },
        onPartial: (text, raw) => {
          if (rec !== r) return
          const speakerId =
            channel === 'mic' ? ME : raw === null ? OTHERS : (r.rawToSpeaker.get(`${channel}:${raw}`) ?? '')
          emitLive({ type: 'partial', channel, speakerId, text })
        },
        onStatus: (status) => emitLive({ type: 'status', channel, status }),
        onError: (message) => {
          if (!isFatalLive(message)) return emitLive({ type: 'error', message })
          const provider = LIVE_NAMES[settings.liveProvider] ?? settings.liveProvider
          emitLive({
            type: 'degraded',
            channel,
            message: `${explain(provider, classify(message))}. La grabación sigue: el audio${withScreen ? ' y la pantalla' : ''} se transcribirán al terminar, o cuando vuelva a haber crédito.`
          })
        }
      })
      if (session) r.sessions.set(channel, session)
    }
  } catch (e) {
    r.sessions.forEach((s) => s.stop())
    throw e
  }

  store.resetAudio(meetingId)
  rec = r
  mutate(meetingId, (m) => {
    m.transcript = []
    m.finalized = false
    // Se conservan las personas con nombre por si se vuelve a grabar la misma reunión.
    for (const [id, sp] of Object.entries(m.speakers)) if (!sp.name) delete m.speakers[id]
    if (channels.includes('mic')) ensureSpeaker(m, ME)
    m.status = 'recording'
    m.hasAudio = true
    m.hasScreen = withScreen
    m.screenOffset = undefined
    m.error = undefined
  })
}

function stopLiveSessions(): void {
  rec?.sessions.forEach((s) => s.stop())
  rec = null
}

/**
 * Transcribe la grabación completa con el proveedor final. Si tu micrófono y el audio
 * de la llamada se grabaron por separado, cada pista se procesa por su lado: tu voz
 * queda identificada sin margen de error y la separación de hablantes solo tiene que
 * distinguir al resto de personas.
 */
async function transcribeRecording(meetingId: string, s: Settings): Promise<RawSegment[] | null> {
  const mic = store.audioTrack(meetingId, 'mic')
  const system = store.audioTrack(meetingId, 'system')
  if (mic && system) {
    const others = s.expectedSpeakers ? Math.max(1, s.expectedSpeakers - 1) : null
    const [mine, theirs] = await Promise.all([
      transcribeFile(s, mic, { diarize: false, expectedSpeakers: null }),
      transcribeFile(s, system, { diarize: true, expectedSpeakers: others })
    ])
    return mergeTracks(mine, theirs)
  }
  const mix = store.audioTrack(meetingId, 'mix')
  return mix ? transcribeFile(s, mix, { diarize: true, expectedSpeakers: s.expectedSpeakers }) : null
}

const LIVE_NAMES: Record<string, string> = { deepgram: 'Deepgram', elevenlabs: 'ElevenLabs' }
const FINAL_NAMES: Record<string, string> = { deepgram: 'Deepgram', elevenlabs: 'ElevenLabs', assemblyai: 'AssemblyAI' }

/** Reuniones cuya pasada final está en marcha: evita lanzar dos a la vez. */
const processing = new Set<string>()

async function finalPass(meetingId: string): Promise<void> {
  if (processing.has(meetingId)) return
  const settings = loadSettings()
  if (settings.finalProvider === 'none' || !store.audioTrack(meetingId, 'mix')) {
    mutate(meetingId, (m) => (m.status = 'done'))
    return
  }
  processing.add(meetingId)
  mutate(meetingId, (m) => {
    m.status = 'processing'
    m.error = undefined
  })
  try {
    const final = (await transcribeRecording(meetingId, settings)) ?? []
    mutate(meetingId, (m) => {
      if (final.length) applyFinalTranscript(m, final)
      m.status = 'done'
    })
  } catch (err) {
    const message = (err as Error).message
    const kind = classify(message)
    const provider = FINAL_NAMES[settings.finalProvider] ?? settings.finalProvider
    // Sin crédito, sin conexión o con la clave mal: la grabación está a salvo y se procesará más tarde.
    mutate(meetingId, (m) => {
      m.status = isRecoverable(kind) ? 'pending' : 'error'
      m.error = isRecoverable(kind) ? `${explain(provider, kind)}.` : `Transcripción final: ${message}`
    })
  } finally {
    processing.delete(meetingId)
  }
}

/** Errores de la IA de resúmenes con un mensaje comprensible (sin crédito, clave rechazada…). */
async function withLlmErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const message = (err as Error).message
    const kind = classify(message)
    if (kind === 'other') throw err
    const provider = loadSettings().llmProvider === 'openai' ? 'OpenAI' : 'Anthropic'
    const hint = kind === 'credits' ? ' Recarga saldo en su consola y vuelve a intentarlo.' : kind === 'auth' ? ' Revísala en Configuración > API keys.' : ' Vuelve a intentarlo en unos minutos.'
    throw new Error(`${explain(provider, kind)}.${hint}`)
  }
}

const RETRY_EVERY = 30 * 60 * 1000

/** Reintenta las transcripciones pendientes (al abrir la app, cada 30 min y al cambiar las claves). */
function retryPending(): void {
  if (rec) return
  for (const m of store.listMeetings()) if (m.status === 'pending') void finalPass(m.id)
}

/**
 * Reuniones que quedaron a medias porque se cerró la app mientras se grababa o se
 * procesaba la transcripción final: se retoma con lo que se llegó a grabar.
 */
function resumeInterrupted(): void {
  for (const m of store.listMeetings()) {
    if (m.status === 'recording' || m.status === 'processing' || m.status === 'pending') void finalPass(m.id)
  }
  setInterval(retryPending, RETRY_EVERY)
}

// ---------------- IPC ----------------

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_e, s: Settings) => {
    const before = loadSettings()
    saveSettings(s)
    applyLoginItem(s)
    // Nuevas claves o proveedor distinto: puede que ya se puedan procesar las pendientes.
    if (JSON.stringify(before.keys) !== JSON.stringify(s.keys) || before.finalProvider !== s.finalProvider) retryPending()
  })
  ipcMain.handle('meeting:retryPending', () => retryPending())
  ipcMain.handle('settings:defaults', () => ({
    prompts: BUILTIN_PROMPTS,
    speakerIdPrompt: DEFAULT_SPEAKER_ID_PROMPT
  }))
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    libraryDir: store.libraryDir()
  }))

  ipcMain.handle('update:get', () => getUpdateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => {
    if (rec) throw new Error('Termina la grabación antes de actualizar.')
    installUpdate()
  })

  ipcMain.handle('library:list', () => ({
    folders: store.listFolders(),
    meetings: store.listMeetings()
  }))
  ipcMain.handle('library:open', () => shell.openPath(store.libraryDir()))
  ipcMain.handle('library:search', (_e, text: string) => store.searchMeetings(text))
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    // Solo enlaces web; nunca rutas locales ni otros protocolos.
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })

  ipcMain.handle('folder:create', (_e, name: string, parentId: string | null) =>
    store.createFolder(name, parentId)
  )
  ipcMain.handle('folder:update', (_e, f: Folder) => store.updateFolder(f))
  ipcMain.handle('folder:delete', (_e, id: string) => store.deleteFolder(id))
  ipcMain.handle('folder:reorder', (_e, u) => store.reorderFolders(u))

  ipcMain.handle('meeting:create', (_e, folderId: string | null) => store.createMeeting(folderId))
  ipcMain.handle('meeting:get', (_e, id: string) => store.getMeeting(id))
  ipcMain.handle(
    'meeting:patch',
    (_e, id: string, patch: Pick<Partial<Meeting>, 'title' | 'sections' | 'summary' | 'summaryPromptId'>) => {
      const m = store.getMeeting(id)
      if (!m) return
      const { title, sections, summary, summaryPromptId } = patch
      store.saveMeeting({
        ...m,
        ...(title !== undefined && { title }),
        ...(sections !== undefined && { sections }),
        ...(summary !== undefined && { summary }),
        ...(summaryPromptId !== undefined && { summaryPromptId })
      })
    }
  )
  ipcMain.handle('meeting:delete', (_e, id: string) => store.deleteMeeting(id))
  ipcMain.handle('meeting:reorder', (_e, u) => store.reorderMeetings(u))
  ipcMain.handle('meeting:retranscribe', (_e, id: string) => finalPass(id))

  ipcMain.handle('meeting:export', async (_e, id: string) => {
    const m = store.getMeeting(id)
    if (!m || !win) return
    const { myName } = loadSettings()
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `${m.title.replace(/[\\/:*?"<>|]/g, '-')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return
    const notes = [...m.sections]
      .sort((a, b) => a.order - b.order)
      .map((s) => `### ${s.title}\n\n${s.content}`)
      .join('\n\n')
    writeFileSync(
      filePath,
      [
        `# ${m.title}`,
        `_${new Date(m.createdAt).toLocaleString('es-ES')}_`,
        m.summary ?? '',
        `## Notas\n\n${notes}`,
        `## Transcripción\n\n${transcriptText(m, myName).replace(/\n/g, '\n\n')}`
      ].join('\n\n')
    )
  })

  // hablantes
  ipcMain.handle('speaker:rename', (_e, meetingId: string, speakerId: string, name: string) => {
    mutate(meetingId, (m) => renameSpeaker(m, speakerId, name.trim()))
    if (name.trim()) rememberPeople([name])
  })
  ipcMain.handle('speaker:merge', (_e, meetingId: string, fromId: string, intoId: string) => {
    // Si se está grabando, lo que siga diciendo esa voz también va a la persona destino.
    if (rec?.meetingId === meetingId) {
      for (const [k, v] of rec.rawToSpeaker) if (v === fromId) rec.rawToSpeaker.set(k, intoId)
    }
    mutate(meetingId, (m) => mergeSpeakers(m, fromId, intoId))
  })
  ipcMain.handle('segment:reassign', (_e, meetingId: string, segmentIds: string[], speakerId: string) =>
    mutate(meetingId, (m) => reassignSegments(m, segmentIds, speakerId))
  )
  ipcMain.handle('segment:edit', (_e, meetingId: string, segmentId: string, text: string) =>
    mutate(meetingId, (m) => {
      m.transcript = m.transcript.map((s) => (s.id === segmentId ? { ...s, text } : s))
    })
  )
  ipcMain.handle('speaker:suggest', async (_e, meetingId: string) => {
    const m = store.getMeeting(meetingId)
    if (!m) throw new Error('Reunión no encontrada')
    return withLlmErrors(() => suggestSpeakerNames(m, loadSettings()))
  })

  // grabación
  ipcMain.handle('recording:start', (_e, meetingId: string, channels: AudioChannel[], withScreen?: boolean) =>
    startRecording(meetingId, channels, withScreen)
  )
  ipcMain.on('recording:pcm', (_e, channel: AudioChannel, chunk: Uint8Array) =>
    rec?.sessions.get(channel)?.sendAudio(chunk)
  )
  ipcMain.handle('screens:list', () => listScreens())
  // La pantalla se activó a mitad de grabación: el vídeo empieza en ese segundo.
  ipcMain.handle('recording:screenStarted', (_e, meetingId: string, offset: number) =>
    mutate(meetingId, (m) => {
      m.hasScreen = true
      m.screenOffset = offset
    })
  )
  // Elige la pantalla por su monitor; si ya no está conectado, se usa la principal.
  ipcMain.handle('screens:select', async (_e, displayId: string) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    screenSourceId = sources.find((s) => s.display_id === displayId)?.id ?? null
  })
  ipcMain.handle('meeting:showScreenFile', (_e, id: string) => {
    const file = store.audioTrack(id, 'screen')
    if (file) shell.showItemInFolder(file)
  })
  ipcMain.on('recording:webm', (_e, meetingId: string, track: RecordingTrack, chunk: Uint8Array) =>
    store.appendAudio(meetingId, track, chunk)
  )
  ipcMain.handle('recording:stop', async (_e, meetingId: string, durationSec: number) => {
    const hadLive = (rec?.sessions.size ?? 0) > 0
    stopLiveSessions()
    mutate(meetingId, (m) => {
      m.durationSec = durationSec
      m.status = 'processing'
    })
    // Deja que lleguen los últimos fragmentos en vivo antes de alinear.
    if (hadLive) await new Promise((r) => setTimeout(r, 3500))
    void finalPass(meetingId)
  })

  // resumen
  ipcMain.handle('summary:generate', async (_e, id: string, promptId: string) => {
    const m = store.getMeeting(id)
    if (!m) throw new Error('Reunión no encontrada')
    const summary = await withLlmErrors(() =>
      summarize(m, loadSettings(), promptId, (delta) => emit('summary:delta', { meetingId: id, delta }))
    )
    mutate(id, (x) => {
      x.summary = summary
      x.summaryPromptId = promptId
    })
    return summary
  })
  ipcMain.handle('meeting:document', (_e, id: string) => {
    const m = store.getMeeting(id)
    return m ? buildMeetingDocument(m, loadSettings().myName) : ''
  })
}

app.whenReady().then(() => {
  if (!primary) return
  store.initStore()
  registerIpc()
  registerMini(() => win, icon)
  handleMediaRequests()

  // getDisplayMedia() en el renderer -> pantalla principal + audio "loopback":
  // todo lo que suena en el equipo (Teams, Meet, Discord, Zoom, navegador...).
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      const source = sources.find((s) => s.id === screenSourceId) ?? sources[0]
      callback({ video: source, audio: 'loopback' })
    },
    { useSystemPicker: false }
  )

  createWindow()
  setupBackground({ getWin: () => win, icon })
  resumeInterrupted()
  initUpdater((s: UpdateState) => emit('update:state', s))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopLiveSessions()
  if (process.platform !== 'darwin') app.quit()
})
