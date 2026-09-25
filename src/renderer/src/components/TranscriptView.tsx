import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, ArrowDown, AudioLines, Play, RefreshCw, UserPlus, UserRound } from 'lucide-react'
import { ME, OTHERS, speakerLabel, type Meeting, type TranscriptSegment } from '@shared/types'
import { fmtTime, highlightParts, speakerColor } from '../util'
import { AudioPlayer, type PlayerHandle } from './AudioPlayer'
import { Avatar } from './SpeakersBar'
import { Popover, soft, Spinner } from './ui'

export interface LivePartial {
  speakerId: string
  text: string
}

interface Props {
  meeting: Meeting
  myName: string
  recording: boolean
  partials: LivePartial[]
  finalProviderName: string
  onReassign: (segmentIds: string[], speakerId: string) => void
  onEditSegment: (segmentId: string, text: string) => void
  onRetranscribe: () => void
  /** Texto buscado: se resalta y se salta a la primera coincidencia. */
  highlight?: string
}

interface Turn {
  key: string
  speakerId: string
  start: number
  segments: TranscriptSegment[]
}

function toTurns(segments: TranscriptSegment[]): Turn[] {
  const turns: Turn[] = []
  for (const s of segments) {
    const last = turns[turns.length - 1]
    if (last && last.speakerId === s.speakerId && s.start - last.segments[last.segments.length - 1].end < 20) {
      last.segments.push(s)
    } else {
      turns.push({ key: s.id, speakerId: s.speakerId, start: s.start, segments: [s] })
    }
  }
  return turns
}

/** Idioma más frecuente de la reunión y si se ha hablado en más de uno. */
function languages(segments: TranscriptSegment[]): { main?: string; mixed: boolean } {
  const count = new Map<string, number>()
  for (const s of segments) if (s.lang) count.set(s.lang, (count.get(s.lang) ?? 0) + (s.end - s.start))
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return { main, mixed: count.size > 1 }
}

export function TranscriptView(p: Props): React.JSX.Element {
  const m = p.meeting
  const turns = useMemo(() => toTurns(m.transcript), [m.transcript])
  const langs = useMemo(() => languages(m.transcript), [m.transcript])
  const player = useRef<PlayerHandle>(null)
  const [playTime, setPlayTime] = useState<number | null>(null)
  const onTime = useCallback((t: number | null) => setPlayTime(t), [])
  const activeId =
    playTime === null ? null : (m.transcript.find((s) => playTime >= s.start && playTime < s.end + 0.3)?.id ?? null)
  const canPlay = m.hasAudio && !p.recording
  const scroller = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [menu, setMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useLayoutEffect(() => {
    const el = scroller.current
    if (stick && el) el.scrollTo({ top: el.scrollHeight, behavior: p.recording ? 'smooth' : 'auto' })
  }, [turns, p.partials, stick, p.recording])

  useEffect(() => {
    if (!p.highlight) return
    const t = setTimeout(() => scroller.current?.querySelector('.seg mark')?.scrollIntoView({ block: 'center' }), 250)
    return () => clearTimeout(t)
  }, [p.highlight, m.id])

  // Mientras se escucha, la transcripción acompaña al audio.
  useEffect(() => {
    if (activeId) scroller.current?.querySelector('.seg.playing')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  const onScroll = (): void => {
    const el = scroller.current
    if (el) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  const label = (id: string): string => speakerLabel(m.speakers[id], p.myName)
  const speakers = Object.values(m.speakers).filter((s) => s.id !== OTHERS)
  const livePartials = p.partials.filter((x) => x.text)
  const empty = turns.length === 0 && livePartials.length === 0

  return (
    <div className={`transcript ${canPlay ? 'has-player' : ''}`}>
      <AnimatePresence>
        {m.status === 'processing' && (
          <motion.div className="banner" {...bannerMotion}>
            <Spinner size={13} />
            <span>
              Procesando la grabación completa con {p.finalProviderName} para separar mejor a cada persona. Los nombres
              que ya hayas puesto se mantienen.
            </span>
          </motion.div>
        )}
        {m.status === 'error' && m.error && (
          <motion.div className="banner error" {...bannerMotion}>
            <AlertCircle size={15} />
            <span>{m.error}</span>
            {m.hasAudio && (
              <button className="btn sm" onClick={p.onRetranscribe}>
                <RefreshCw size={13} /> Reintentar
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="transcript-scroll" ref={scroller} onScroll={onScroll}>
        {empty ? (
          <motion.div className="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
            <div className={`empty-icon ${p.recording ? 'listening' : ''}`}>
              <AudioLines size={22} />
            </div>
            {p.recording ? (
              <>
                <h4>Escuchando</h4>
                <p>El texto aparecerá aquí en cuanto alguien hable.</p>
              </>
            ) : (
              <>
                <h4>Sin transcripción</h4>
                <p>
                  Pulsa <strong>Grabar</strong> cuando empiece la reunión. Funciona con Teams, Google Meet, Zoom, Discord o
                  cualquier aplicación que suene en el equipo.
                </p>
              </>
            )}
          </motion.div>
        ) : (
          <div className="turns">
            <AnimatePresence initial={false}>
              {turns.map((t) => {
                const sp = m.speakers[t.speakerId]
                const color = speakerColor(t.speakerId, sp?.index ?? 0)
                return (
                  <motion.div
                    key={t.key}
                    className={`turn ${t.speakerId === ME ? 'me' : ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={soft}
                  >
                    <Avatar speaker={sp} label={label(t.speakerId)} size={28} />
                    <div className="turn-body">
                      <div className="turn-head">
                        <span className="anchor">
                          <button
                            className="turn-name"
                            style={{ color }}
                            onClick={() => setMenu(menu === t.key ? null : t.key)}
                            title="Cambiar quién dice esto"
                          >
                            {label(t.speakerId)}
                          </button>
                          <Popover open={menu === t.key} onClose={() => setMenu(null)} className="pop-speaker">
                            <div className="menu-heading">¿Quién dice esto?</div>
                            {!m.speakers[ME] && (
                              <button className="menu-item" onClick={() => { setMenu(null); p.onReassign(t.segments.map((s) => s.id), ME) }}>
                                <span className="mi-icon"><UserRound size={14} /></span>
                                <span className="mi-label">Yo</span>
                              </button>
                            )}
                            {speakers.map((s) => (
                              <button
                                key={s.id}
                                className={`menu-item ${s.id === t.speakerId ? 'current' : ''}`}
                                onClick={() => {
                                  setMenu(null)
                                  if (s.id !== t.speakerId) p.onReassign(t.segments.map((x) => x.id), s.id)
                                }}
                              >
                                <Avatar speaker={s} label={label(s.id)} size={18} />
                                <span className="mi-label">{label(s.id)}</span>
                              </button>
                            ))}
                            <div className="menu-sep" />
                            <button className="menu-item" onClick={() => { setMenu(null); p.onReassign(t.segments.map((s) => s.id), 'new') }}>
                              <span className="mi-icon"><UserPlus size={14} /></span>
                              <span className="mi-label">Persona nueva</span>
                            </button>
                          </Popover>
                        </span>
                        {canPlay ? (
                          <button className="turn-time seek" onClick={() => player.current?.playFrom(t.start)} title="Escuchar desde aquí">
                            <Play size={9} fill="currentColor" /> {fmtTime(t.start)}
                          </button>
                        ) : (
                          <span className="turn-time">{fmtTime(t.start)}</span>
                        )}
                        {langs.mixed && t.segments[0].lang && t.segments[0].lang !== langs.main && (
                          <span className="lang-tag" title="Idioma detectado">{t.segments[0].lang.toUpperCase()}</span>
                        )}
                      </div>
                      <div className="turn-text">
                        {t.segments.map((s) =>
                          editing === s.id ? (
                            <textarea
                              key={s.id}
                              className="seg-edit"
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => {
                                setEditing(null)
                                if (draft.trim() && draft !== s.text) p.onEditSegment(s.id, draft.trim())
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault()
                                  ;(e.target as HTMLTextAreaElement).blur()
                                }
                                if (e.key === 'Escape') setEditing(null)
                              }}
                            />
                          ) : (
                            <span
                              key={s.id}
                              className={`seg ${s.id === activeId ? 'playing' : ''}`}
                              onDoubleClick={() => {
                                setEditing(s.id)
                                setDraft(s.text)
                              }}
                              title="Doble clic para corregir el texto"
                            >
                              {p.highlight
                                ? highlightParts(s.text, p.highlight).map((part, i) =>
                                    part.hit ? <mark key={i}>{part.text}</mark> : part.text
                                  )
                                : s.text}{' '}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
              {livePartials.map((x, i) => (
                <motion.div
                  key={`partial-${i}`}
                  className="turn partial"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={soft}
                >
                  <Avatar speaker={m.speakers[x.speakerId]} label={x.speakerId ? label(x.speakerId) : '·'} size={28} active />
                  <div className="turn-body">
                    <div className="turn-head">
                      <span className="turn-name muted">{x.speakerId ? label(x.speakerId) : 'Hablando'}</span>
                      <span className="typing"><i /><i /><i /></span>
                    </div>
                    <div className="turn-text">{x.text}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {canPlay && (
        <AudioPlayer
          key={m.id}
          ref={player}
          src={`meeting-audio://${m.id}/?v=${m.durationSec}`}
          video={m.hasScreen ? `meeting-audio://${m.id}/screen?v=${m.durationSec}` : undefined}
          duration={m.durationSec}
          onTime={onTime}
        />
      )}

      <AnimatePresence>
        {!stick && !empty && (
          <motion.button
            className="jump-bottom"
            initial={{ opacity: 0, y: 10, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 10, x: '-50%' }}
            transition={soft}
            onClick={() => setStick(true)}
          >
            <ArrowDown size={13} /> Ir al final
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

const bannerMotion = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: soft
}
