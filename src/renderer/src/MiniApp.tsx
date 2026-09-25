import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2, Mic, MicOff, Monitor, MonitorOff, MonitorSpeaker, MonitorX, Pause, Play, Square } from 'lucide-react'
import type { MiniCommand, MiniState, SourceState } from '@shared/types'
import { fmtTime } from './util'

/** Ventana flotante del modo mini: últimas líneas en directo y controles de la grabación. */
export default function MiniApp(): React.JSX.Element {
  const [s, setS] = useState<MiniState | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.getMiniState().then((x) => x && setS(x))
    return window.api.onMiniState(setS)
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s?.lines])

  const send = (cmd: MiniCommand): void => window.api.sendMiniCommand(cmd)

  return (
    <div className={`mini ${s?.paused ? 'is-paused' : ''}`}>
      <header className="mini-bar">
        {s?.paused ? <Pause size={11} className="mini-paused-icon" /> : <span className="rec-dot" />}
        <span className="mini-time">{s?.paused ? 'En pausa' : fmtTime(s?.elapsed ?? 0)}</span>
        <span className="mini-title">{s?.title}</span>
        <button className="mini-btn" onClick={() => send('expand')} title="Volver a la ventana completa" aria-label="Expandir">
          <Maximize2 size={13} />
        </button>
      </header>

      {s?.notice && <p className="mini-notice">{s.notice}</p>}
      <div className="mini-lines" ref={scroller}>
        {!s?.lines.length ? (
          <p className="mini-empty">{s?.paused ? 'Grabación en pausa' : 'Escuchando…'}</p>
        ) : (
          s.lines.map((l) => (
            <p key={l.id} className={`mini-line ${l.partial ? 'partial' : ''}`}>
              <b style={{ color: l.color }}>{l.speaker}</b> {l.text}
            </p>
          ))
        )}
      </div>

      <footer className="mini-controls">
        <SourceButton
          state={s?.mic ?? 'off'}
          on={<Mic size={14} />}
          off={<MicOff size={14} />}
          label="Tu micrófono"
          onClick={() => send('toggleMic')}
        />
        <SourceButton
          state={s?.system ?? 'off'}
          on={<MonitorSpeaker size={14} />}
          off={<MonitorX size={14} />}
          label="Audio de la reunión"
          onClick={() => send('toggleSystem')}
        />
        <button
          className={`mini-btn ${s?.screen ? '' : 'dim'}`}
          onClick={() => send('toggleScreen')}
          title={s?.screen ? 'Pantalla: se graba. Pulsa para desactivarla' : 'Pantalla: no se graba. Pulsa para grabarla'}
        >
          {s?.screen ? <Monitor size={14} /> : <MonitorOff size={14} />}
        </button>
        <button
          className={`mini-btn ${s?.paused ? 'active' : ''}`}
          onClick={() => send(s?.paused ? 'resume' : 'pause')}
          title={s?.paused ? 'Reanudar la grabación' : 'Pausar la grabación'}
        >
          {s?.paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <span className="grow" />
        <button className="mini-btn stop" onClick={() => send('stop')} title="Detener la grabación">
          <Square size={10} fill="currentColor" /> Detener
        </button>
      </footer>
    </div>
  )
}

function SourceButton(p: {
  state: SourceState
  on: React.JSX.Element
  off: React.JSX.Element
  label: string
  onClick: () => void
}): React.JSX.Element {
  const title =
    p.state === 'off'
      ? `${p.label}: no se captura`
      : p.state === 'muted'
        ? `${p.label}: silenciado. Pulsa para volver a grabarlo`
        : `${p.label}: se graba. Pulsa para silenciarlo`
  return (
    <button className={`mini-btn ${p.state === 'muted' ? 'muted' : ''}`} disabled={p.state === 'off'} onClick={p.onClick} title={title}>
      {p.state === 'on' ? p.on : p.off}
    </button>
  )
}
