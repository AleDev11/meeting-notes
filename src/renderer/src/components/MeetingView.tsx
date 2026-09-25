import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AudioLines,
  Download,
  Mic,
  MicOff,
  MonitorSpeaker,
  MonitorX,
  MoreHorizontal,
  NotebookPen,
  PanelLeftOpen,
  RefreshCw,
  ScrollText,
  Square,
  Trash2
} from 'lucide-react'
import type { Meeting, NoteSection, Settings, SpeakerSuggestion } from '@shared/types'
import type { Levels } from '../audio/recorder'
import { fmtDate, fmtDuration, fmtTime } from '../util'
import { NotesPanel } from './NotesPanel'
import { SpeakersBar } from './SpeakersBar'
import { SummaryPanel } from './SummaryPanel'
import { TranscriptView, type LivePartial } from './TranscriptView'
import { MenuItem, Popover, quick, Spinner, Tabs, useMediaQuery } from './ui'

const FINAL_NAMES = { elevenlabs: 'ElevenLabs', deepgram: 'Deepgram', assemblyai: 'AssemblyAI', none: '—' }

interface Props {
  meeting: Meeting
  settings: Settings
  sidebarHidden: boolean
  onShowSidebar: () => void
  isRecording: boolean
  otherRecording: boolean
  starting: boolean
  elapsed: number
  levels: Levels
  captureMic: boolean
  captureSystem: boolean
  onCaptureMic: (v: boolean) => void
  onCaptureSystem: (v: boolean) => void
  onStart: () => void
  onStop: () => void
  partials: LivePartial[]
  onTitle: (t: string) => void
  onSections: (s: NoteSection[]) => void
  onSummaryEdit: (s: string) => void
  onRenameSpeaker: (id: string, name: string) => Promise<void>
  onMergeSpeakers: (from: string, into: string) => Promise<void>
  onSuggestSpeakers: () => Promise<SpeakerSuggestion[]>
  onReassign: (segmentIds: string[], speakerId: string) => void
  onEditSegment: (segmentId: string, text: string) => void
  onRetranscribe: () => void
  onGenerateSummary: (promptId: string) => void
  summaryStreaming: string | null
  onExport: () => void
  onDelete: () => void
}

type PaneTab = 'transcript' | 'notes' | 'summary'

const paneSwap = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.16 }
}

export function MeetingView(p: Props): React.JSX.Element {
  const m = p.meeting
  const narrow = useMediaQuery('(max-width: 1080px)')
  const [tab, setTab] = useState<PaneTab>('transcript')
  const [sideTab, setSideTab] = useState<'notes' | 'summary'>('notes')
  const [menu, setMenu] = useState(false)
  const activeSpeakers = p.partials.filter((x) => x.text).map((x) => x.speakerId)
  const providerName = p.settings.llmProvider === 'openai' ? 'ChatGPT' : 'Claude'

  const transcript = (
    <TranscriptView
      key={m.id}
      meeting={m}
      myName={p.settings.myName}
      recording={p.isRecording}
      partials={p.partials}
      finalProviderName={FINAL_NAMES[p.settings.finalProvider]}
      onReassign={p.onReassign}
      onEditSegment={p.onEditSegment}
      onRetranscribe={p.onRetranscribe}
    />
  )
  const notes = <NotesPanel sections={m.sections} elapsedSec={p.isRecording ? p.elapsed : null} onChange={p.onSections} />
  const summary = (
    <SummaryPanel
      key={m.id}
      meeting={m}
      prompts={p.settings.prompts}
      defaultPromptId={p.settings.defaultPromptId}
      providerName={providerName}
      streaming={p.summaryStreaming}
      recording={p.isRecording}
      onGenerate={(id) => {
        setTab('summary')
        setSideTab('summary')
        p.onGenerateSummary(id)
      }}
      onEdit={p.onSummaryEdit}
      onExport={p.onExport}
    />
  )

  const tabItems = [
    { id: 'transcript' as const, label: 'Transcripción', icon: <AudioLines size={14} /> },
    { id: 'notes' as const, label: 'Notas', icon: <NotebookPen size={14} /> },
    { id: 'summary' as const, label: 'Resumen', icon: <ScrollText size={14} /> }
  ]

  const recordingBadge =
    m.transcript.length > 0 ? (
      <span className={`status-tag ${m.finalized ? 'final' : 'live'}`}>{m.finalized ? 'Final' : 'En vivo'}</span>
    ) : null

  return (
    <div className="meeting-view">
      <header className="mv-header">
        <div className="mv-top">
          {p.sidebarHidden && (
            <button className="icon-btn" title="Mostrar panel" onClick={p.onShowSidebar}>
              <PanelLeftOpen size={16} />
            </button>
          )}
          <div className="mv-titles">
            <input className="mv-title" value={m.title} onChange={(e) => p.onTitle(e.target.value)} aria-label="Título" />
            <div className="mv-meta">
              <span>{fmtDate(m.createdAt)}</span>
              {m.durationSec > 0 && !p.isRecording && <span>{fmtDuration(m.durationSec)}</span>}
              {m.status === 'processing' && (
                <span className="meta-accent">
                  <Spinner size={10} /> Identificando personas
                </span>
              )}
            </div>
          </div>

          <div className="rec-controls">
            <CaptureToggle
              on={p.captureMic}
              disabled={p.isRecording}
              level={p.isRecording ? p.levels.mic : undefined}
              onIcon={<Mic size={15} />}
              offIcon={<MicOff size={15} />}
              label="Micrófono"
              onChange={p.onCaptureMic}
            />
            <CaptureToggle
              on={p.captureSystem}
              disabled={p.isRecording}
              level={p.isRecording ? p.levels.system : undefined}
              onIcon={<MonitorSpeaker size={15} />}
              offIcon={<MonitorX size={15} />}
              label="Sistema"
              onChange={p.onCaptureSystem}
            />
            <motion.button
              layout
              transition={quick}
              className={`btn rec-btn ${p.isRecording ? 'is-recording' : ''}`}
              disabled={!p.isRecording && (p.otherRecording || p.starting || m.status === 'processing')}
              onClick={p.isRecording ? p.onStop : p.onStart}
              title={
                p.isRecording
                  ? 'Detener grabación'
                  : p.otherRecording
                    ? 'Ya hay otra reunión grabándose'
                    : 'Empezar a grabar y transcribir'
              }
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {p.isRecording ? (
                  <motion.span key="stop" className="rec-btn-inner" {...swap}>
                    <Square size={11} fill="currentColor" />
                    <span className="timer">{fmtTime(p.elapsed)}</span>
                  </motion.span>
                ) : (
                  <motion.span key="rec" className="rec-btn-inner" {...swap}>
                    {p.starting ? <Spinner size={12} /> : <span className="rec-dot static" />}
                    Grabar
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            <span className="anchor">
              <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Más opciones">
                <MoreHorizontal size={17} />
              </button>
              <Popover open={menu} onClose={() => setMenu(false)} align="right">
                <MenuItem icon={<Download size={14} />} onClick={() => { setMenu(false); p.onExport() }}>
                  Exportar a Markdown
                </MenuItem>
                <MenuItem
                  icon={<RefreshCw size={14} />}
                  disabled={!m.hasAudio || p.isRecording || m.status === 'processing'}
                  onClick={() => { setMenu(false); p.onRetranscribe() }}
                >
                  Reprocesar grabación
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem danger icon={<Trash2 size={14} />} disabled={p.isRecording} onClick={() => { setMenu(false); p.onDelete() }}>
                  Eliminar reunión
                </MenuItem>
              </Popover>
            </span>
          </div>
        </div>

        <SpeakersBar
          meeting={m}
          myName={p.settings.myName}
          knownPeople={p.settings.knownPeople}
          activeSpeakerIds={activeSpeakers}
          onRename={p.onRenameSpeaker}
          onMerge={p.onMergeSpeakers}
          onSuggest={p.onSuggestSpeakers}
        />
      </header>

      {narrow ? (
        <div className="panes stacked">
          <div className="pane-bar">
            <Tabs id="narrow" items={tabItems} value={tab} onChange={setTab} />
            {tab === 'transcript' && recordingBadge}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} className="pane-body" {...paneSwap}>
              {tab === 'transcript' ? transcript : tab === 'notes' ? notes : summary}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : (
        <div className="panes split">
          <section className="pane">
            <div className="pane-bar">
              <span className="pane-title">
                <AudioLines size={14} /> Transcripción
              </span>
              {recordingBadge}
              <span className="grow" />
              {m.hasAudio && !p.isRecording && m.status !== 'processing' && (
                <button className="btn ghost sm" onClick={p.onRetranscribe} title="Volver a procesar la grabación">
                  <RefreshCw size={13} /> Reprocesar
                </button>
              )}
            </div>
            <div className="pane-body">{transcript}</div>
          </section>
          <section className="pane side">
            <div className="pane-bar">
              <Tabs id="side" items={tabItems.slice(1) as { id: 'notes' | 'summary'; label: string; icon: React.JSX.Element }[]} value={sideTab} onChange={setSideTab} />
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={sideTab} className="pane-body" {...paneSwap}>
                {sideTab === 'notes' ? notes : summary}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      )}
    </div>
  )
}

const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: quick
}

function CaptureToggle(p: {
  on: boolean
  disabled: boolean
  level?: number
  onIcon: React.JSX.Element
  offIcon: React.JSX.Element
  label: string
  onChange: (v: boolean) => void
}): React.JSX.Element {
  const live = p.level !== undefined && p.on
  return (
    <button
      className={`capture ${p.on ? 'on' : 'off'} ${live ? 'live' : ''}`}
      disabled={p.disabled}
      onClick={() => p.onChange(!p.on)}
      title={`${p.label}: ${p.on ? 'se captura' : 'no se captura'}`}
      aria-pressed={p.on}
    >
      {p.on ? p.onIcon : p.offIcon}
      <span className="capture-label">{p.label}</span>
      {live && (
        <span className="bars" aria-hidden>
          {[0.55, 1, 0.75].map((k, i) => (
            <motion.i key={i} animate={{ scaleY: Math.max(0.15, Math.min(1, (p.level ?? 0) * k * 1.6)) }} transition={{ duration: 0.08 }} />
          ))}
        </span>
      )}
    </button>
  )
}
