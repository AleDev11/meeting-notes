import { randomUUID } from 'crypto'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell } from 'electron'
import { existsSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import {
  ME,
  OTHERS,
  type AudioChannel,
  type Folder,
  type LiveEvent,
  type Meeting,
  type Settings,
  type UpdateState
} from '../shared/types'
import { BUILTIN_PROMPTS, DEFAULT_SPEAKER_ID_PROMPT, loadSettings, rememberPeople, saveSettings } from './settings'
import {
  applyFinalTranscript,
  ensureSpeaker,
  mergeSpeakers,
  newSpeakerId,
  reassignSegments,
  renameSpeaker
} from './speakers'
import * as store from './store'
import { buildMeetingDocument, suggestSpeakerNames, summarize, transcriptText } from './summarize'
import { createLiveSession, transcribeFile } from './transcription'
import type { LiveSession, RawSegment } from './transcription/types'
import { checkForUpdates, getUpdateState, initUpdater, installUpdate } from './updater'

let win: BrowserWindow | null = null

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

function startRecording(meetingId: string, channels: AudioChannel[]): void {
  const settings = loadSettings()
  stopLiveSessions()
  const r: ActiveRecording = { meetingId, sessions: new Map(), rawToSpeaker: new Map() }

  try {
    for (const channel of channels) {
      const session = createLiveSession(settings, channel, {
        onSegment: (raw: RawSegment) => {
          if (rec !== r) return
          mutate(meetingId, (m) => {
            const speakerId = speakerFor(r, m, channel, raw.speaker)
            const { text, start, end } = raw
            m.transcript.push({ id: randomUUID(), speakerId, text, start, end, source: 'live' })
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
        onError: (message) => emitLive({ type: 'error', message })
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
    m.error = undefined
  })
}

function stopLiveSessions(): void {
  rec?.sessions.forEach((s) => s.stop())
  rec = null
}

async function finalPass(meetingId: string): Promise<void> {
  const settings = loadSettings()
  const file = store.audioPath(meetingId)
  if (settings.finalProvider === 'none' || !existsSync(file) || statSync(file).size === 0) {
    mutate(meetingId, (m) => (m.status = 'done'))
    return
  }
  mutate(meetingId, (m) => {
    m.status = 'processing'
    m.error = undefined
  })
  try {
    const final = await transcribeFile(settings, file)
    mutate(meetingId, (m) => {
      if (final.length) applyFinalTranscript(m, final)
      m.status = 'done'
    })
  } catch (err) {
    mutate(meetingId, (m) => {
      m.status = 'error'
      m.error = `Transcripción final: ${(err as Error).message}`
    })
  }
}

// ---------------- IPC ----------------

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_e, s: Settings) => saveSettings(s))
  ipcMain.handle('settings:defaults', () => ({
    prompts: BUILTIN_PROMPTS,
    speakerIdPrompt: DEFAULT_SPEAKER_ID_PROMPT
  }))
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
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
    return suggestSpeakerNames(m, loadSettings())
  })

  // grabación
  ipcMain.handle('recording:start', (_e, meetingId: string, channels: AudioChannel[]) =>
    startRecording(meetingId, channels)
  )
  ipcMain.on('recording:pcm', (_e, channel: AudioChannel, chunk: Uint8Array) =>
    rec?.sessions.get(channel)?.sendAudio(chunk)
  )
  ipcMain.on('recording:webm', (_e, meetingId: string, chunk: Uint8Array) =>
    store.appendAudio(meetingId, chunk)
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
    const summary = await summarize(m, loadSettings(), promptId, (delta) =>
      emit('summary:delta', { meetingId: id, delta })
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
  store.initStore()
  registerIpc()

  // getDisplayMedia() en el renderer -> pantalla principal + audio "loopback":
  // todo lo que suena en el equipo (Teams, Meet, Discord, Zoom, navegador...).
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const [screen] = await desktopCapturer.getSources({ types: ['screen'] })
      callback({ video: screen, audio: 'loopback' })
    },
    { useSystemPicker: false }
  )

  createWindow()
  initUpdater((s: UpdateState) => emit('update:state', s))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopLiveSessions()
  if (process.platform !== 'darwin') app.quit()
})
