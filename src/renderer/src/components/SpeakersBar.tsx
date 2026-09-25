import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, GitMerge, UserRound, UserSearch, Users, X } from 'lucide-react'
import { ME, OTHERS, speakerLabel, type Meeting, type Speaker, type SpeakerSuggestion } from '@shared/types'
import { errorMessage, initials, speakerColor } from '../util'
import { Popover, soft, Spinner, useUi } from './ui'

interface Props {
  meeting: Meeting
  myName: string
  knownPeople: string[]
  activeSpeakerIds: string[]
  onRename: (id: string, name: string) => Promise<void>
  onMerge: (fromId: string, intoId: string) => Promise<void>
  onSuggest: () => Promise<SpeakerSuggestion[]>
}

export function Avatar({
  speaker,
  label,
  size = 26,
  active
}: {
  speaker: Speaker | undefined
  label: string
  size?: number
  active?: boolean
}): React.JSX.Element {
  const color = speakerColor(speaker?.id ?? '', speaker?.index ?? 0)
  return (
    <span
      className={`avatar ${active ? 'speaking' : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ['--c' as string]: color }}
    >
      {speaker?.id === OTHERS ? <Users size={size * 0.5} /> : initials(label)}
    </span>
  )
}

const rank = (s: Speaker): number => (s.id === ME ? -1 : s.id === OTHERS ? 999 : s.index)

export function SpeakersBar(p: Props): React.JSX.Element {
  const ui = useUi()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<SpeakerSuggestion[] | null>(null)
  const [loading, setLoading] = useState(false)

  const talk = useMemo(() => {
    const t: Record<string, number> = {}
    let total = 0
    for (const s of p.meeting.transcript) {
      const d = Math.max(0.5, s.end - s.start)
      t[s.speakerId] = (t[s.speakerId] ?? 0) + d
      total += d
    }
    return { t, total }
  }, [p.meeting.transcript])

  const speakers = Object.values(p.meeting.speakers).sort((a, b) => rank(a) - rank(b))
  const label = (s: Speaker): string => speakerLabel(s, p.myName)
  const unnamed = speakers.filter((s) => !s.name && s.id !== ME && s.id !== OTHERS)

  const open = (s: Speaker): void => {
    setEditing(editing === s.id ? null : s.id)
    setDraft(s.name)
  }
  const save = async (id: string, name: string): Promise<void> => {
    setEditing(null)
    await p.onRename(id, name).catch((e) => ui.toast(errorMessage(e)))
  }
  const suggest = async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await p.onSuggest()
      setSuggestions(res)
      if (res.length === 0) ui.toast('No hay pistas suficientes en la conversación para deducir nombres.', 'info')
    } catch (e) {
      ui.toast(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const quickNames = p.knownPeople
    .filter((n) => !speakers.some((s) => s.name === n))
    .filter((n) => !draft || n.toLowerCase().includes(draft.toLowerCase()))
    .slice(0, 8)

  return (
    <div className="people">
      <div className="people-row">
        <span className="people-label">Personas</span>
        {speakers.length === 0 ? (
          <span className="people-empty">Aparecerán aquí según vayan hablando; podrás ponerles nombre en cualquier momento.</span>
        ) : (
          <div className="chips">
            <AnimatePresence initial={false}>
              {speakers.map((s) => {
                const pct = talk.total ? Math.round(((talk.t[s.id] ?? 0) / talk.total) * 100) : 0
                const others = speakers.filter((x) => x.id !== s.id && x.id !== OTHERS)
                return (
                  <motion.div
                    key={s.id}
                    className="anchor"
                    layout
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={soft}
                  >
                    <button
                      className={`chip ${!s.name && s.id !== ME ? 'unnamed' : ''} ${editing === s.id ? 'open' : ''}`}
                      onClick={() => open(s)}
                      title={s.id === OTHERS ? 'Voces sin separar' : 'Asignar nombre'}
                    >
                      <Avatar speaker={s} label={label(s)} size={20} active={p.activeSpeakerIds.includes(s.id)} />
                      <motion.span key={label(s)} className="chip-name" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                        {label(s)}
                      </motion.span>
                      {pct > 0 && <span className="chip-pct">{pct}%</span>}
                    </button>
                    <Popover open={editing === s.id} onClose={() => setEditing(null)} className="pop-speaker">
                      <div className="pop-head">
                        <Avatar speaker={s} label={label(s)} size={28} />
                        <div>
                          <div className="pop-title">{s.id === OTHERS ? 'Participantes' : label(s)}</div>
                          <div className="pop-sub">
                            {s.id === OTHERS
                              ? 'Voces del sistema sin separar'
                              : `${pct}% del tiempo de palabra`}
                          </div>
                        </div>
                      </div>
                      {s.id === OTHERS ? (
                        <p className="pop-text">
                          El proveedor en vivo no separa voces. Al detener la grabación, la transcripción final las
                          dividirá en Persona 1, 2, 3…
                        </p>
                      ) : (
                        <>
                          <form
                            className="pop-form"
                            onSubmit={(e) => {
                              e.preventDefault()
                              void save(s.id, draft)
                            }}
                          >
                            <input
                              autoFocus
                              placeholder={s.id === ME ? 'Tu nombre' : '¿Quién es?'}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                            />
                            <button className="btn primary icon-only" type="submit" title="Guardar">
                              <Check size={15} />
                            </button>
                          </form>
                          {quickNames.length > 0 && (
                            <div className="pop-tags">
                              {quickNames.map((n) => (
                                <button key={n} className="tag" onClick={() => void save(s.id, n)}>
                                  {n}
                                </button>
                              ))}
                            </div>
                          )}
                          {s.name && (
                            <button className="menu-item" onClick={() => void save(s.id, '')}>
                              <span className="mi-icon"><X size={14} /></span>
                              <span className="mi-label">Quitar nombre</span>
                            </button>
                          )}
                        </>
                      )}
                      {others.length > 0 && (
                        <>
                          <div className="menu-heading">
                            <GitMerge size={12} /> {s.id === OTHERS ? 'Asignar todo a' : 'Es la misma persona que'}
                          </div>
                          <div className="pop-list">
                            {s.id !== ME && s.id !== OTHERS && !speakers.some((x) => x.id === ME) && (
                              <button className="menu-item" onClick={() => { setEditing(null); void p.onMerge(s.id, ME) }}>
                                <span className="mi-icon"><UserRound size={14} /></span>
                                <span className="mi-label">Yo</span>
                              </button>
                            )}
                            {others.map((o) => (
                              <button key={o.id} className="menu-item" onClick={() => { setEditing(null); void p.onMerge(s.id, o.id) }}>
                                <Avatar speaker={o} label={label(o)} size={18} />
                                <span className="mi-label">{label(o)}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </Popover>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
        {unnamed.length > 0 && p.meeting.transcript.length > 3 && (
          <button className="btn ghost sm" onClick={() => void suggest()} disabled={loading} title="Deduce quién es cada persona a partir de la conversación">
            {loading ? <Spinner size={13} /> : <UserSearch size={14} />}
            Deducir nombres
          </button>
        )}
      </div>

      <AnimatePresence>
        {suggestions && suggestions.length > 0 && (
          <motion.div
            className="suggestions"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={soft}
          >
            <div className="suggestions-inner">
              <div className="suggestions-head">
                <span>Nombres deducidos de la conversación</span>
                <span className="grow" />
                <button
                  className="btn primary sm"
                  onClick={async () => {
                    for (const s of suggestions) await p.onRename(s.speakerId, s.name)
                    setSuggestions(null)
                  }}
                >
                  Aceptar todos
                </button>
                <button className="icon-btn sm" onClick={() => setSuggestions(null)} aria-label="Descartar">
                  <X size={14} />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {suggestions.map((s) => {
                  const sp = p.meeting.speakers[s.speakerId]
                  return (
                    <motion.div
                      key={s.speakerId}
                      className="suggestion"
                      layout
                      exit={{ opacity: 0, x: 12 }}
                      transition={soft}
                    >
                      <Avatar speaker={sp} label={label(sp)} size={24} />
                      <span className="sug-main">
                        <span>
                          <span className="muted">{label(sp)}</span> es <strong>{s.name}</strong>
                        </span>
                        <span className="sug-reason">{s.reason}</span>
                      </span>
                      <button
                        className="btn sm"
                        onClick={async () => {
                          await p.onRename(s.speakerId, s.name)
                          setSuggestions((l) => l?.filter((x) => x.speakerId !== s.speakerId) ?? null)
                        }}
                      >
                        <Check size={14} /> Aceptar
                      </button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
