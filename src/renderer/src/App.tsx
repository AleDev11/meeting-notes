import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, KeyRound, PanelLeftOpen, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  speakerLabel,
  type AudioChannel,
  type Folder,
  type Meeting,
  type MeetingSummary,
  type MiniCommand,
  type MiniLine,
  type Settings,
  type SourceState,
  type UpdateState
} from '@shared/types'
import { channelsFor, MeetingRecorder, type Levels, type Source } from './audio/recorder'
import { MeetingView } from './components/MeetingView'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import type { LivePartial } from './components/TranscriptView'
import { Logo, soft, UiProvider, useMediaQuery, useUi } from './components/ui'

const page = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }
}
import { errorMessage, speakerColor } from './util'

type Editable = Pick<Meeting, 'title' | 'sections' | 'summary'>

export default function App(): React.JSX.Element {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  )
}

function Shell(): React.JSX.Element {
  const ui = useUi()
  const narrow = useMediaQuery('(max-width: 760px)')
  const [folders, setFolders] = useState<Folder[]>([])
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [view, setView] = useState<'meeting' | 'settings'>('meeting')
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState<Record<Source, boolean>>({ mic: false, system: false })
  const [miniOpen, setMiniOpen] = useState(false)
  const [levels, setLevels] = useState<Levels>({})
  const [partials, setPartials] = useState<Partial<Record<AudioChannel, LivePartial>>>({})
  const [captureMic, setCaptureMic] = useState(true)
  const [captureSystem, setCaptureSystem] = useState(true)
  const [summaryStream, setSummaryStream] = useState<{ id: string; text: string } | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)

  const recorder = useRef<MeetingRecorder | null>(null)
  const meetingRef = useRef<Meeting | null>(null)
  meetingRef.current = meeting
  const pending = useRef<{ id: string; patch: Partial<Editable>; timer: number } | null>(null)

  const refreshLibrary = useCallback(async () => {
    const lib = await window.api.listLibrary()
    setFolders(lib.folders)
    setMeetings(lib.meetings)
  }, [])

  const flushSave = useCallback(async () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    await window.api.patchMeeting(p.id, p.patch)
  }, [])

  useEffect(() => {
    void refreshLibrary()
    void window.api.getSettings().then(setSettings)

    const offUpdated = window.api.onMeetingUpdated((m) => {
      const cur = meetingRef.current
      if (cur?.id === m.id) {
        // El proceso principal gestiona transcripción y hablantes; título y notas son locales.
        const editingSummary = pending.current?.id === m.id && pending.current.patch.summary !== undefined
        setMeeting({
          ...m,
          title: cur.title,
          sections: cur.sections,
          summary: editingSummary ? cur.summary : m.summary
        })
      }
      setMeetings((list) =>
        list.map((x) => (x.id === m.id ? { ...x, status: m.status, durationSec: m.durationSec } : x))
      )
    })
    const offLive = window.api.onLiveEvent((e) => {
      if (e.type === 'partial') {
        setPartials((p) => ({ ...p, [e.channel]: { speakerId: e.speakerId, text: e.text } }))
      } else if (e.type === 'error') {
        ui.toast(e.message)
      }
    })
    const offSummary = window.api.onSummaryDelta(({ meetingId, delta }) =>
      setSummaryStream((s) => (s && s.id === meetingId ? { ...s, text: s.text + delta } : s))
    )
    void window.api.getUpdateState().then(setUpdate)
    const offUpdate = window.api.onUpdateState((s) => {
      setUpdate((prev) => {
        if (s.status === 'ready' && prev?.status !== 'ready') {
          ui.toast(`La versión ${s.version} está lista. Se instalará al cerrar la app.`, 'info')
        }
        return s
      })
    })
    const beforeUnload = (): void => void flushSave()
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      offUpdated()
      offLive()
      offSummary()
      offUpdate()
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [refreshLibrary, flushSave, ui])

  useEffect(() => {
    if (!recordingId) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(recorder.current?.elapsed ?? 0), 500)
    return () => clearInterval(t)
  }, [recordingId])

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn()
      } catch (e) {
        ui.toast(errorMessage(e))
      }
    },
    [ui]
  )

  const openMeeting = async (id: string): Promise<void> => {
    await flushSave()
    setMeeting(await window.api.getMeeting(id))
    setView('meeting')
    setDrawerOpen(false)
  }

  const edit = (patch: Partial<Editable>): void => {
    const cur = meetingRef.current
    if (!cur) return
    setMeeting({ ...cur, ...patch })
    if (patch.title !== undefined) {
      setMeetings((list) => list.map((m) => (m.id === cur.id ? { ...m, title: patch.title! } : m)))
    }
    const prev = pending.current?.id === cur.id ? pending.current : null
    if (prev) clearTimeout(prev.timer)
    else void flushSave()
    pending.current = {
      id: cur.id,
      patch: { ...(prev?.patch ?? {}), ...patch },
      timer: window.setTimeout(() => void flushSave(), 500)
    }
  }

  // ---------- biblioteca ----------

  const newMeeting = (folderId: string | null): Promise<void> =>
    run(async () => {
      await flushSave()
      const m = await window.api.createMeeting(folderId)
      await refreshLibrary()
      setMeeting(m)
      setView('meeting')
      setDrawerOpen(false)
    })

  const newFolder = async (parentId: string | null): Promise<void> => {
    const name = await ui.askText('Nueva carpeta', 'Nueva carpeta')
    if (name) await run(async () => {
      await window.api.createFolder(name, parentId)
      await refreshLibrary()
    })
  }

  const renameFolder = async (f: Folder): Promise<void> => {
    const name = await ui.askText('Renombrar carpeta', f.name)
    if (name) await run(async () => {
      await window.api.updateFolder({ ...f, name })
      await refreshLibrary()
    })
  }

  const deleteFolder = async (f: Folder): Promise<void> => {
    const ok = await ui.confirm(
      'Eliminar carpeta',
      `Se eliminará “${f.name}” y sus subcarpetas. Las reuniones que contiene no se borran: pasan a la carpeta superior.`,
      { confirmLabel: 'Eliminar', danger: true }
    )
    if (ok) await run(async () => {
      await window.api.deleteFolder(f.id)
      await refreshLibrary()
    })
  }

  const deleteMeeting = async (m: Pick<MeetingSummary, 'id' | 'title'>): Promise<void> => {
    if (m.id === recordingId) return ui.toast('No puedes eliminar una reunión mientras se graba.')
    const ok = await ui.confirm(
      'Eliminar reunión',
      `Se borrarán “${m.title}”, su grabación, transcripción, notas y resumen. No se puede deshacer.`,
      { confirmLabel: 'Eliminar', danger: true }
    )
    if (!ok) return
    await run(async () => {
      if (pending.current?.id === m.id) {
        clearTimeout(pending.current.timer)
        pending.current = null
      }
      await window.api.deleteMeeting(m.id)
      if (meetingRef.current?.id === m.id) setMeeting(null)
      await refreshLibrary()
    })
  }

  const moveMeeting = (id: string, folderId: string | null, beforeId: string | null): Promise<void> =>
    run(async () => {
      const dragged = meetings.find((m) => m.id === id)
      if (!dragged) return
      const siblings = meetings
        .filter((m) => m.folderId === folderId && m.id !== id)
        .sort((a, b) => a.order - b.order)
      const idx = beforeId ? siblings.findIndex((m) => m.id === beforeId) : -1
      siblings.splice(idx < 0 ? siblings.length : idx, 0, dragged)
      await window.api.reorderMeetings(siblings.map((m, i) => ({ id: m.id, folderId, order: i })))
      if (meetingRef.current?.id === id) setMeeting({ ...meetingRef.current, folderId })
      await refreshLibrary()
    })

  const moveFolder = (id: string, parentId: string | null, beforeId: string | null): Promise<void> =>
    run(async () => {
      // Evita meter una carpeta dentro de sí misma o de sus descendientes.
      for (let p = parentId; p; p = folders.find((f) => f.id === p)?.parentId ?? null) {
        if (p === id) return
      }
      const dragged = folders.find((f) => f.id === id)
      if (!dragged) return
      const siblings = folders.filter((f) => f.parentId === parentId && f.id !== id).sort((a, b) => a.order - b.order)
      const idx = beforeId ? siblings.findIndex((f) => f.id === beforeId) : -1
      siblings.splice(idx < 0 ? siblings.length : idx, 0, dragged)
      await window.api.reorderFolders(siblings.map((f, i) => ({ id: f.id, parentId, order: i })))
      await refreshLibrary()
    })

  // ---------- grabación ----------

  const missingKeys = (s: Settings): string[] => {
    const out: string[] = []
    if (s.liveProvider !== 'none' && !s.keys[s.liveProvider]) out.push(s.liveProvider)
    if (s.finalProvider !== 'none' && !s.keys[s.finalProvider] && !out.includes(s.finalProvider))
      out.push(s.finalProvider)
    return out
  }

  const startRecording = async (): Promise<void> => {
    const m = meetingRef.current
    if (!m || !settings || recordingId) return
    const missing = missingKeys(settings)
    if (missing.length) {
      const go = await ui.confirm(
        'Falta configurar la transcripción',
        `Necesitas la API key de ${missing.join(' y ')} para transcribir. ¿Ir a Configuración?`,
        { confirmLabel: 'Ir a Configuración' }
      )
      if (go) setView('settings')
      return
    }
    if (
      m.transcript.length &&
      !(await ui.confirm(
        'Volver a grabar',
        'Esta reunión ya tiene transcripción. Si grabas de nuevo se sustituirá (las notas se mantienen).',
        { confirmLabel: 'Grabar de nuevo', danger: true }
      ))
    )
      return

    setStarting(true)
    await run(async () => {
      await flushSave()
      const plan = {
        meetingId: m.id,
        mic: captureMic,
        system: captureSystem,
        micDeviceId: settings.micDeviceId,
        separate: settings.separateMic
      }
      if (!plan.mic && !plan.system) throw new Error('Activa al menos el micrófono o el audio del sistema.')
      await window.api.startRecording(m.id, channelsFor(plan))
      const rec = new MeetingRecorder(setLevels)
      try {
        await rec.start(plan)
      } catch (e) {
        await rec.stop()
        await window.api.stopRecording(m.id, 0)
        throw e
      }
      recorder.current = rec
      setPaused(false)
      setMuted({ mic: false, system: false })
      setRecordingId(m.id)
      setPartials({})
    })
    setStarting(false)
  }

  const stopRecording = (): Promise<void> =>
    run(async () => {
      if (!recordingId || !recorder.current) return
      const id = recordingId
      const duration = await recorder.current.stop()
      recorder.current = null
      setRecordingId(null)
      setPaused(false)
      setPartials({})
      setLevels({})
      if (miniOpen) await window.api.closeMini()
      await window.api.stopRecording(id, duration)
    })

  const togglePause = (): void => {
    const rec = recorder.current
    if (!rec) return
    if (paused) rec.resume()
    else rec.pause()
    setPaused(!paused)
    if (!paused) setPartials({})
  }

  const toggleMute = (source: Source): void => {
    const rec = recorder.current
    if (!rec) return
    rec.setMuted(source, !muted[source])
    setMuted({ ...muted, [source]: !muted[source] })
  }

  const openMini = async (): Promise<void> => {
    // La ventana mini muestra la reunión que se está grabando.
    if (recordingId && meetingRef.current?.id !== recordingId) await openMeeting(recordingId)
    setMiniOpen(true)
    await window.api.openMini()
  }

  // Órdenes que llegan desde la ventana mini.
  const miniHandlers = useRef<(cmd: MiniCommand) => void>(() => {})
  miniHandlers.current = (cmd) => {
    if (cmd === 'pause' || cmd === 'resume') togglePause()
    else if (cmd === 'toggleMic') toggleMute('mic')
    else if (cmd === 'toggleSystem') toggleMute('system')
    else if (cmd === 'stop') void stopRecording()
  }
  useEffect(() => {
    const offCommand = window.api.onMiniCommand((cmd) => miniHandlers.current(cmd))
    const offClosed = window.api.onMiniClosed(() => setMiniOpen(false))
    return () => {
      offCommand()
      offClosed()
    }
  }, [])

  const recordingMeeting = meeting && meeting.id === recordingId ? meeting : null
  const sourceState = (source: Source, captured: boolean): SourceState =>
    !captured ? 'off' : muted[source] ? 'muted' : 'on'

  useEffect(() => {
    if (!miniOpen || !settings) return
    const m = recordingMeeting
    const label = (id: string): string => speakerLabel(m?.speakers[id], settings.myName)
    const color = (id: string): string => speakerColor(id, m?.speakers[id]?.index ?? 0)
    const lines: MiniLine[] = (m?.transcript.slice(-8) ?? []).map((s) => ({
      id: s.id,
      speaker: label(s.speakerId),
      color: color(s.speakerId),
      text: s.text
    }))
    for (const [channel, x] of Object.entries(partials)) {
      if (x?.text) lines.push({ id: `partial-${channel}`, speaker: x.speakerId ? label(x.speakerId) : 'Hablando', color: color(x.speakerId), text: x.text, partial: true })
    }
    window.api.publishMiniState({
      title: m?.title ?? meetings.find((x) => x.id === recordingId)?.title ?? '',
      recording: !!recordingId,
      paused,
      elapsed,
      mic: sourceState('mic', captureMic),
      system: sourceState('system', captureSystem),
      lines
    })
  }, [miniOpen, settings, recordingMeeting, recordingId, meetings, partials, paused, elapsed, muted, captureMic, captureSystem])

  const generateSummary = (promptId: string): Promise<void> =>
    run(async () => {
      const m = meetingRef.current
      if (!m) return
      await flushSave()
      setSummaryStream({ id: m.id, text: '' })
      try {
        await window.api.generateSummary(m.id, promptId)
      } finally {
        setSummaryStream(null)
      }
    })

  const installUpdate = async (): Promise<void> => {
    if (!update?.version) return
    if (recordingId) return ui.toast('Termina la grabación antes de actualizar.')
    const ok = await ui.confirm(
      `Actualizar a v${update.version}`,
      'La app se cerrará y volverá a abrirse con la nueva versión.',
      { confirmLabel: 'Reiniciar y actualizar' }
    )
    if (!ok) return
    await run(async () => {
      await flushSave()
      await window.api.installUpdate()
    })
  }

  const saveSettings = async (s: Settings): Promise<void> => {
    await window.api.saveSettings(s)
    setSettings(s)
  }

  if (!settings) return <div className="app loading" />

  const noKeys = Object.values(settings.keys).every((k) => !k)
  const showSidebar = narrow ? drawerOpen : !sidebarHidden
  const isRecordingThis = !!meeting && recordingId === meeting.id

  return (
    <div className={`app ${narrow ? 'is-narrow' : ''}`}>
      <AnimatePresence initial={false}>
        {showSidebar && narrow && (
          <motion.div
            key="backdrop"
            className="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
          />
        )}
        {showSidebar && (
          <motion.div
            key="sidebar"
            className="sidebar-shell"
            initial={narrow ? { x: -300 } : { width: 0, opacity: 0 }}
            animate={narrow ? { x: 0 } : { width: 272, opacity: 1 }}
            exit={narrow ? { x: -300 } : { width: 0, opacity: 0 }}
            transition={soft}
          >
          <Sidebar
            folders={folders}
            meetings={meetings}
            selectedId={meeting?.id ?? null}
            recordingId={recordingId}
            settingsOpen={view === 'settings'}
            onSelect={(id) => void openMeeting(id)}
            onNewMeeting={(f) => void newMeeting(f)}
            onNewFolder={(p) => void newFolder(p)}
            onRenameFolder={(f) => void renameFolder(f)}
            onDeleteFolder={(f) => void deleteFolder(f)}
            onDeleteMeeting={(m) => void deleteMeeting(m)}
            onMoveMeeting={(id, f, b) => void moveMeeting(id, f, b)}
            onMoveFolder={(id, p, b) => void moveFolder(id, p, b)}
            onOpenSettings={() => {
              void flushSave()
              setView('settings')
              setDrawerOpen(false)
            }}
            onCollapse={() => (narrow ? setDrawerOpen(false) : setSidebarHidden(true))}
            updateReady={update?.status === 'ready' ? (update.version ?? null) : null}
            onInstallUpdate={() => void installUpdate()}
          />
          </motion.div>
        )}
      </AnimatePresence>

      <main className="main">
        <AnimatePresence initial={false}>
          {recordingId && (!isRecordingThis || view === 'settings') && (
            <motion.button
              key="rec-banner"
              className="recording-banner"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 34, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={soft}
              onClick={() => void openMeeting(recordingId)}
            >
              <span className="rec-dot" /> Grabando “{meetings.find((m) => m.id === recordingId)?.title}” · volver a la reunión
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait" initial={false}>
        {view === 'settings' ? (
          <motion.div key="settings" className="settings-wrap" {...page}>
            {!showSidebar && (
              <button className="icon-btn floating-toggle" onClick={() => (narrow ? setDrawerOpen(true) : setSidebarHidden(false))}>
                <PanelLeftOpen size={18} />
              </button>
            )}
            <SettingsView
              settings={settings}
              onChange={saveSettings}
              update={update}
              recording={!!recordingId}
              onInstallUpdate={() => void installUpdate()}
            />
          </motion.div>
        ) : meeting ? (
          <motion.div key={meeting.id} className="page" {...page}>
          <MeetingView
            meeting={meeting}
            settings={settings}
            sidebarHidden={!showSidebar}
            onShowSidebar={() => (narrow ? setDrawerOpen(true) : setSidebarHidden(false))}
            isRecording={isRecordingThis}
            otherRecording={!!recordingId && !isRecordingThis}
            starting={starting}
            elapsed={elapsed}
            paused={paused}
            muted={muted}
            onTogglePause={togglePause}
            onToggleMute={toggleMute}
            onOpenMini={() => void openMini()}
            levels={levels}
            captureMic={captureMic}
            captureSystem={captureSystem}
            onCaptureMic={setCaptureMic}
            onCaptureSystem={setCaptureSystem}
            onMicDevice={(micDeviceId) => void saveSettings({ ...settings, micDeviceId })}
            onStart={() => void startRecording()}
            onStop={() => void stopRecording()}
            partials={isRecordingThis ? Object.values(partials).filter((x): x is LivePartial => !!x) : []}
            onTitle={(title) => edit({ title })}
            onSections={(sections) => edit({ sections })}
            onSummaryEdit={(summary) => edit({ summary })}
            onRenameSpeaker={async (id, name) => {
              await window.api.renameSpeaker(meeting.id, id, name)
              if (name) setSettings(await window.api.getSettings())
            }}
            onMergeSpeakers={(from, into) => run(() => window.api.mergeSpeakers(meeting.id, from, into))}
            onSuggestSpeakers={() => window.api.suggestSpeakers(meeting.id)}
            onReassign={(ids, sp) => void run(() => window.api.reassignSegments(meeting.id, ids, sp))}
            onEditSegment={(segId, text) => void run(() => window.api.editSegment(meeting.id, segId, text))}
            onRetranscribe={() => void run(() => window.api.retranscribe(meeting.id))}
            onGenerateSummary={(id) => void generateSummary(id)}
            summaryStreaming={summaryStream?.id === meeting.id ? summaryStream.text : null}
            onExport={() =>
              void run(async () => {
                await flushSave()
                await window.api.exportMeeting(meeting.id)
              })
            }
            onDelete={() => void deleteMeeting(meeting)}
          />
          </motion.div>
        ) : (
          <motion.div key="welcome" className="page" {...page}>
          <Welcome
            noKeys={noKeys}
            showToggle={!showSidebar}
            onToggle={() => (narrow ? setDrawerOpen(true) : setSidebarHidden(false))}
            onNew={() => void newMeeting(null)}
            onSettings={() => setView('settings')}
          />
          </motion.div>
        )}
        </AnimatePresence>
      </main>
    </div>
  )
}

function Welcome(p: {
  noKeys: boolean
  showToggle: boolean
  onToggle: () => void
  onNew: () => void
  onSettings: () => void
}): React.JSX.Element {
  const steps = [
    {
      title: 'Conecta los servicios',
      text: 'Una API key de transcripción (Deepgram, ElevenLabs o AssemblyAI) y otra de IA (Claude u OpenAI).',
      done: !p.noKeys
    },
    { title: 'Crea una reunión y pulsa Grabar', text: 'Se captura tu micrófono y el audio del equipo, sea cual sea la app.' },
    { title: 'Pon nombre a cada persona', text: 'Persona 1, 2, 3… en directo o después. También puedes deducirlos de la conversación.' },
    { title: 'Genera el acta', text: 'Decisiones, acciones y puntos clave con plantillas que puedes editar.' }
  ]
  return (
    <div className="welcome">
      {p.showToggle && (
        <button className="icon-btn floating-toggle" onClick={p.onToggle}>
          <PanelLeftOpen size={16} />
        </button>
      )}
      <motion.div
        className="welcome-inner"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      >
        <motion.div variants={item}>
          <Logo size={34} />
        </motion.div>
        <motion.h1 variants={item}>Cada reunión, con quién dijo qué.</motion.h1>
        <motion.p variants={item} className="welcome-lead">
          Graba llamadas de Teams, Google Meet, Zoom o Discord, identifica a cada persona mientras habla, toma notas por
          secciones y termina con un acta lista para compartir.
        </motion.p>
        <motion.ol variants={item} className="checklist">
          {steps.map((s, i) => (
            <li key={s.title} className={s.done ? 'done' : ''}>
              <span className="check-num">{s.done ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
              <span className="check-body">
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </span>
            </li>
          ))}
        </motion.ol>
        <motion.div variants={item} className="welcome-actions">
          {p.noKeys ? (
            <>
              <button className="btn primary lg" onClick={p.onSettings}>
                <KeyRound size={15} /> Configurar API keys
              </button>
              <button className="btn ghost lg" onClick={p.onNew}>
                Empezar sin configurar <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <button className="btn primary lg" onClick={p.onNew}>
              <Plus size={15} /> Nueva reunión
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>
  )
}

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: soft }
}
