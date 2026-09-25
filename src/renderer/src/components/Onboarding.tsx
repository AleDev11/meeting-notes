import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  ExternalLink,
  Globe,
  KeyRound,
  Mic,
  Plus,
  Speaker,
  User,
  X
} from 'lucide-react'
import type { ApiKeys, FinalProvider, KeySource, LiveProvider, LlmProvider, LocalAiState, Settings } from '@shared/types'
import { finalProviderFor, languageNames, LANGUAGES, liveProviderFor } from '@shared/languages'
import { Field, Logo, quick, soft, spring, Toggle } from './ui'
import { MultiSelect } from './Select'
import { micLabel } from '../audio/recorder'
import { keyInfo, KeyInput, KeyStatus, useKeyChecks, type KeyState } from './keys'
import { languageHint, MicField, SEPARATE_MIC_DESC } from './SettingsView'
import { LocalAiCard, localAiSummary, useLocalAi } from './LocalAi'

type SttId = 'elevenlabs' | 'deepgram' | 'assemblyai'
type LlmKeyId = 'anthropic' | 'openai'

const STEPS = ['Bienvenida', 'Transcripción', 'Resúmenes', 'Idiomas', 'Audio', 'Listo'] as const

const STT: { id: SttId; name: string; tag?: string; desc: string }[] = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    tag: 'Recomendado',
    desc: 'Vale para todo: transcripción en vivo y final, con catalán. Con esta basta.'
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    desc: 'Separa a las personas en directo. Combinado con ElevenLabs, lo mejor de los dos.'
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    desc: 'Solo al terminar: la transcripción con hablantes aparece cuando detienes la grabación.'
  }
]

const LLM: { id: LlmProvider; name: string; desc: string }[] = [
  { id: 'anthropic', name: 'Claude', desc: 'Actas muy cuidadas. Pago por uso con tu cuenta de Anthropic.' },
  { id: 'openai', name: 'ChatGPT', desc: 'Modelos de OpenAI. Pago por uso con tu cuenta de OpenAI.' },
  { id: 'ollama', name: 'Local (Ollama)', desc: 'Gratis y sin salir de tu equipo. Se instala sola con un clic; más lenta y pide un ordenador potente.' }
]

const NAMES: Record<string, string> = {
  deepgram: 'Deepgram',
  elevenlabs: 'ElevenLabs',
  assemblyai: 'AssemblyAI',
  anthropic: 'Claude',
  openai: 'ChatGPT',
  ollama: 'Ollama'
}

/** Proveedores en vivo y final que salen de las keys disponibles. */
function plan(has: Record<SttId, boolean>): { live: LiveProvider; final: FinalProvider } {
  return {
    live: has.deepgram ? 'deepgram' : has.elevenlabs ? 'elevenlabs' : 'none',
    final: has.elevenlabs ? 'elevenlabs' : has.assemblyai ? 'assemblyai' : has.deepgram ? 'deepgram' : 'none'
  }
}

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 32 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -32 })
}

interface Props {
  settings: Settings
  /** Se ha abierto desde Configuración: se puede cerrar sin terminar. */
  closable: boolean
  onSave: (s: Settings) => Promise<void>
  onFinish: (createMeeting: boolean) => void
  onClose: () => void
}

export function Onboarding({ settings, closable, onSave, onFinish, onClose }: Props): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  /** Configuración al abrir el asistente: la referencia para saber qué keys ya estaban. */
  const [initial] = useState(settings)
  const [d, setD] = useState(settings)
  const { checks, check, clear } = useKeyChecks()
  const timers = useRef<Partial<Record<keyof ApiKeys, number>>>({})
  const body = useRef<HTMLDivElement>(null)

  const [stt, setStt] = useState<SttId>(() => STT.find((p) => initial.keys[p.id])?.id ?? 'elevenlabs')
  const [llm, setLlm] = useState<LlmProvider>(() =>
    initial.llmProvider === 'ollama' ? 'ollama' : initial.keys.openai && !initial.keys.anthropic ? 'openai' : 'anthropic'
  )
  /** Resúmenes aplazados con "Configurar más tarde". */
  const [llmLater, setLlmLater] = useState(false)
  /** Origen de las keys que ya había (guardadas o de .env.local). */
  const [sources, setSources] = useState<Partial<Record<keyof ApiKeys, KeySource>>>({})
  /** Keys detectadas que el usuario está sustituyendo por otra. */
  const [replacing, setReplacing] = useState<Partial<Record<keyof ApiKeys, boolean>>>({})

  useEffect(() => {
    void window.api.keySources().then(setSources)
  }, [])

  const localAi = useLocalAi()
  /** Ollama ya en marcha con el modelo configurado (no hace falta activarla). */
  const [localReady, setLocalReady] = useState(false)
  useEffect(() => {
    if (llm !== 'ollama') return
    void window.api.localAiDetect().then((det) => setLocalReady(det.running && det.models.includes(initial.ollamaModel)))
  }, [llm, initial.ollamaModel])
  // Al terminar de activarse, el proceso principal guarda proveedor y modelo: el borrador los incorpora.
  useEffect(() => window.api.onSettingsPatched((patch) => setD((x) => ({ ...x, ...patch }))), [])

  // Las keys que ya había (al reabrir el asistente) se comprueban al entrar.
  useEffect(() => {
    for (const k of Object.keys(initial.keys) as (keyof ApiKeys)[]) if (initial.keys[k]) void check(k, initial.keys[k])
    const t = timers.current
    return () => Object.values(t).forEach(clearTimeout)
  }, [initial.keys, check])

  const set = (patch: Partial<Settings>): void => setD((x) => ({ ...x, ...patch }))

  const setKey = (id: keyof ApiKeys, v: string): void => {
    setD((x) => ({ ...x, keys: { ...x.keys, [id]: v } }))
    clear(id)
    clearTimeout(timers.current[id])
    // Se comprueba al dejar de escribir (o justo al pegar).
    if (v) timers.current[id] = window.setTimeout(() => void check(id, v), 450)
  }

  /** Key utilizable: comprobada ahora o la misma que ya estaba guardada. */
  const usable = (id: keyof ApiKeys): boolean => {
    const c = checks[id]
    if (c && c !== 'checking' && c.status === 'valid') return true
    return !!initial.keys[id] && d.keys[id] === initial.keys[id] && c !== 'checking' && (!c || c.status === 'network')
  }
  const has = { elevenlabs: usable('elevenlabs'), deepgram: usable('deepgram'), assemblyai: usable('assemblyai') }
  const sttReady = has.elevenlabs || has.deepgram || has.assemblyai
  const providers = plan(has)
  // Lo que se usará de verdad: con catalán mezclado puede pasar a ElevenLabs.
  const planned = { ...d, keys: { ...d.keys, elevenlabs: has.elevenlabs ? d.keys.elevenlabs : '' }, liveProvider: providers.live, finalProvider: providers.final }
  const effective = { live: liveProviderFor(planned), final: finalProviderFor(planned) }
  const llmReady =
    llm === 'ollama' ? localReady || localAi?.status === 'running' || localAi?.status === 'done' : usable(llm)
  const llmOn = !llmLater && llmReady

  /** Configuración que se guarda: solo las keys comprobadas; las demás se quedan como estaban. */
  const build = (): Settings => {
    const keys = { ...initial.keys }
    for (const k of Object.keys(keys) as (keyof ApiKeys)[]) if (usable(k)) keys[k] = d.keys[k]
    const keepLive = d.liveProvider === 'none' || usable(d.liveProvider)
    const keepFinal = d.finalProvider === 'none' || usable(d.finalProvider)
    return {
      ...d,
      keys,
      // Al reabrir el asistente se respeta la elección de proveedores si sigue siendo válida.
      liveProvider: initial.onboardingDone && keepLive ? d.liveProvider : providers.live,
      finalProvider: initial.onboardingDone && keepFinal ? d.finalProvider : providers.final,
      llmProvider: llmOn ? llm : d.llmProvider
    }
  }

  const go = (to: number): void => {
    setDir(to > step ? 1 : -1)
    setStep(to)
    body.current?.scrollTo({ top: 0 })
    if (to > step && step > 0) void onSave(build())
  }

  const blocked = step === 1 ? !sttReady : step === 2 ? !llmReady : false
  // En Resúmenes no hace falta: el botón Configurar más tarde ya indica la salida.
  const hint = step === 1 && !sttReady ? 'Pega y valida una key para continuar' : ''

  const panel = (id: keyof ApiKeys): React.JSX.Element => {
    const source = initial.keys[id] ? sources[id] : undefined
    return (
      <KeyPanel
        id={id}
        value={d.keys[id]}
        state={checks[id] ?? null}
        detected={source && !replacing[id] ? { source, key: initial.keys[id] } : undefined}
        canRestore={!!source && !!replacing[id]}
        onChange={(v) => setKey(id, v)}
        onRetry={() => void check(id, d.keys[id])}
        onReplace={() => {
          setReplacing((r) => ({ ...r, [id]: true }))
          setKey(id, '')
        }}
        onRestore={() => {
          setReplacing((r) => ({ ...r, [id]: false }))
          setKey(id, initial.keys[id])
        }}
      />
    )
  }

  const finish = (create: boolean): void => {
    void onSave({ ...build(), onboardingDone: true }).then(() => onFinish(create))
  }

  return (
    <div className="onb">
      <header className="onb-head">
        <span className="onb-brand">
          <Logo size={20} /> Meeting Notes
        </span>
        <div className="onb-progress" aria-label={`Paso ${step + 1} de ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((label, i) => (
            <span key={label} className={`onb-seg ${i < step ? 'done' : ''}`} title={label}>
              {i <= step && (
                <motion.span
                  className="onb-seg-fill"
                  initial={i === step ? { scaleX: 0 } : false}
                  animate={{ scaleX: 1 }}
                  transition={soft}
                />
              )}
            </span>
          ))}
        </div>
        <span className="onb-count">
          {step + 1} / {STEPS.length}
        </span>
        {closable && (
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar el asistente" title="Cerrar el asistente">
            <X size={16} />
          </button>
        )}
      </header>

      <div className="onb-body" ref={body}>
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            className={`onb-step ${step === 0 || step === STEPS.length - 1 ? 'centered' : ''}`}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 && <WelcomeStep />}

            {step === 1 && (
              <>
                <StepHead
                  eyebrow="Imprescindible"
                  title="Conecta la transcripción"
                  lead="Es lo único que necesitas para empezar: un servicio que convierta la voz en texto. Pagas al proveedor solo por lo que grabes; todos ofrecen crédito o un plan gratuito para probar."
                />
                <div className="onb-reco">
                  <strong>Nuestra recomendación:</strong> ElevenLabs. Una sola key cubre la transcripción en vivo y la final,
                  y entiende el catalán. Si además quieres ver quién habla mientras dura la reunión, añade Deepgram.
                </div>
                <ChoiceCards
                  options={STT}
                  value={stt}
                  onChange={setStt}
                  status={(id) => (usable(id as SttId) ? 'ok' : checks[id as SttId] === 'checking' ? 'checking' : null)}
                />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={stt} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={quick}>
                    {panel(stt)}
                  </motion.div>
                </AnimatePresence>
                <AnimatePresence initial={false}>
                  {sttReady && (
                    <motion.div
                      className="onb-plan"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={soft}
                    >
                      <span className="onb-plan-title">Así se transcribirá</span>
                      <div className="onb-plan-inner">
                        <span>
                          <span className="muted">Durante la reunión</span>
                          <strong>{effective.live === 'none' ? 'Sin texto en vivo' : NAMES[effective.live]}</strong>
                        </span>
                        <span>
                          <span className="muted">Al terminar</span>
                          <strong>{NAMES[effective.final]}</strong>
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {step === 2 && (
              <>
                <StepHead
                  eyebrow="Opcional"
                  title="Resúmenes con IA"
                  lead="La IA redacta el acta (decisiones, acciones, puntos clave) y sugiere el nombre de cada persona. Puedes grabar y transcribir sin esto y añadirlo cuando quieras."
                />
                <ChoiceCards
                  options={LLM}
                  value={llm}
                  onChange={(v) => {
                    setLlm(v)
                    setLlmLater(false)
                  }}
                  status={(id) =>
                    id === 'ollama'
                      ? localReady || localAi?.status === 'done'
                        ? 'ok'
                        : null
                      : usable(id as LlmKeyId) ? 'ok' : checks[id as LlmKeyId] === 'checking' ? 'checking' : null
                  }
                />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={llm} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={quick}>
                    {llm === 'ollama' ? (
                      <LocalAiCard
                        s={d}
                        set={set}
                        onboarding
                        onStarted={(ollamaModel) => set({ llmProvider: 'ollama', ollamaModel })}
                      />
                    ) : (
                      panel(llm)
                    )}
                  </motion.div>
                </AnimatePresence>
              </>
            )}

            {step === 3 && (
              <>
                <StepHead
                  title="Idiomas y tu nombre"
                  lead="Indicar los idiomas que se hablan mejora mucho la transcripción. Tu nombre sirve para etiquetar tu voz."
                />
                <section className="card">
                  <Field label="Idiomas de las reuniones" hint={languageHint(build())}>
                    <MultiSelect
                      value={d.languages}
                      options={LANGUAGES.map(([value, label]) => ({ value, label }))}
                      onChange={(languages) => set({ languages })}
                      empty="Detectar cualquier idioma"
                    />
                  </Field>
                  <Field label="Tu nombre" hint="Lo que digas por el micrófono aparecerá con este nombre en la transcripción y en las actas.">
                    <input value={d.myName} placeholder="Yo" onChange={(e) => set({ myName: e.target.value })} />
                  </Field>
                </section>
              </>
            )}

            {step === 4 && (
              <>
                <StepHead
                  title="Micrófono y audio de la reunión"
                  lead="Se graban dos fuentes a la vez: tu micrófono y el sonido del equipo, donde se oye a los demás."
                />
                <section className="card">
                  <h2>
                    <Mic size={16} /> Tu micrófono
                  </h2>
                  <MicField
                    value={d.micDeviceId}
                    onChange={(micDeviceId) => void micLabel(micDeviceId).then((micDeviceLabel) => set({ micDeviceId, micDeviceLabel }))}
                  />
                  <p className="muted small">Pulsa Probar micrófono y habla: la barra debería moverse con tu voz.</p>
                </section>
                <section className="card">
                  <h2>
                    <Speaker size={16} /> Audio de la reunión
                  </h2>
                  <p className="small onb-text">
                    Se captura directamente del sistema, lo que suena por tus altavoces o auriculares. Funciona con Teams,
                    Google Meet, Zoom, Discord, Slack o el navegador sin instalar nada ni conectar la app a la llamada.
                  </p>
                  <Toggle
                    checked={d.separateMic}
                    onChange={(v) => set({ separateMic: v })}
                    label="Tratar el micrófono como “yo”"
                    description={SEPARATE_MIC_DESC}
                  />
                </section>
              </>
            )}

            {step === 5 && <DoneStep s={build()} llmOn={llmOn} localAi={localAi} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="onb-foot">
        <div className="onb-foot-inner">
          {step > 0 && (
            <button className="btn ghost lg" onClick={() => go(step - 1)}>
              <ArrowLeft size={15} /> Atrás
            </button>
          )}
          <span className="grow" />
          <AnimatePresence initial={false}>
            {hint && (
              <motion.span
                key={hint}
                className="onb-hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={quick}
              >
                {hint}
              </motion.span>
            )}
          </AnimatePresence>
          {step === 2 && !llmReady && (
            <button
              className="btn ghost lg"
              onClick={() => {
                setLlmLater(true)
                go(3)
              }}
            >
              Configurar más tarde
            </button>
          )}
          {step === STEPS.length - 1 ? (
            <>
              <button className="btn ghost lg" onClick={() => finish(false)}>
                Ir a la app
              </button>
              <button className="btn primary lg" onClick={() => finish(true)}>
                <Plus size={15} /> Crear primera reunión
              </button>
            </>
          ) : (
            <button className="btn primary lg" disabled={blocked} onClick={() => go(step + 1)}>
              {step === 0 ? 'Empezar' : 'Siguiente'} <ArrowRight size={15} />
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

function StepHead({ eyebrow, title, lead }: { eyebrow?: string; title: string; lead: string }): React.JSX.Element {
  return (
    <div className="onb-step-head">
      {eyebrow && <span className="onb-eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      <p className="onb-lead">{lead}</p>
    </div>
  )
}

function WelcomeStep(): React.JSX.Element {
  const items = [
    { icon: <KeyRound size={16} />, title: 'Una API key de transcripción', text: 'Lo único imprescindible. Te explicamos dónde se consigue.' },
    { icon: <Brain size={16} />, title: 'IA para las actas', text: 'Opcional: Claude, ChatGPT o un modelo local.' },
    { icon: <Mic size={16} />, title: 'Idiomas y micrófono', text: 'Para que la transcripción sea lo más fiel posible.' }
  ]
  return (
    <motion.div className="onb-welcome" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } }}>
      <motion.div variants={item}>
        <Logo size={40} />
      </motion.div>
      <motion.h1 variants={item}>Cada reunión, con quién dijo qué.</motion.h1>
      <motion.p variants={item} className="onb-lead">
        Meeting Notes graba tus llamadas de Teams, Meet, Zoom o cualquier otra app, las transcribe separando a cada persona y
        redacta el acta con IA. Las reuniones se guardan en tu equipo.
      </motion.p>
      <motion.p variants={item} className="onb-sub">
        Lo dejamos listo en unos minutos:
      </motion.p>
      <motion.ul variants={item} className="onb-list">
        {items.map((x) => (
          <li key={x.title}>
            <span className="onb-list-icon">{x.icon}</span>
            <span className="check-body">
              <strong>{x.title}</strong>
              <span>{x.text}</span>
            </span>
          </li>
        ))}
      </motion.ul>
    </motion.div>
  )
}

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: soft }
}

function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  status
}: {
  options: { id: T; name: string; desc: string; tag?: string }[]
  value: T
  onChange: (v: T) => void
  status: (id: T) => 'ok' | 'checking' | null
}): React.JSX.Element {
  return (
    <div className="onb-choices" role="radiogroup">
      {options.map((o) => {
        const st = status(o.id)
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            className={`provider-card ${value === o.id ? 'active' : ''}`}
            onClick={() => onChange(o.id)}
          >
            <span className="radio" />
            <span className="pc-body">
              <span className="pc-name">
                {o.name}
                {o.tag && <span className="badge">{o.tag}</span>}
                <AnimatePresence initial={false}>
                  {st === 'ok' && (
                    <motion.span
                      className="badge ok"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={spring}
                    >
                      <Check size={11} strokeWidth={3} /> Lista
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className="pc-desc">{o.desc}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

const SOURCE_LABELS: Record<KeySource, string> = {
  saved: 'Guardada en la app',
  file: 'Del archivo .env.local',
  env: 'De una variable de entorno'
}

/** Nunca se muestra la key entera: solo los últimos caracteres. */
const mask = (key: string): string => `•••• ${key.slice(-4)}`

function KeyPanel({
  id,
  value,
  state,
  detected,
  canRestore,
  onChange,
  onRetry,
  onReplace,
  onRestore
}: {
  id: keyof ApiKeys
  value: string
  state: KeyState
  /** Key que ya estaba disponible: se muestra enmascarada en lugar del campo. */
  detected?: { source: KeySource; key: string }
  canRestore: boolean
  onChange: (v: string) => void
  onRetry: () => void
  onReplace: () => void
  onRestore: () => void
}): React.JSX.Element {
  const info = keyInfo(id)
  return (
    <section className="card onb-panel">
      <div className="onb-panel-head">
        <div>
          <h2>API key de {info.name}</h2>
          <span className="muted small">{info.use}</span>
        </div>
        <button className="btn" onClick={() => void window.api.openExternal(info.url)} title={info.url}>
          {detected ? 'Gestionar keys' : 'Crear la key'} <ExternalLink size={13} />
        </button>
      </div>
      {detected ? (
        <div className="onb-key">
          <div className={`onb-detected ${state && state !== 'checking' && (state.status === 'invalid' || state.status === 'forbidden') ? 'is-invalid' : ''}`}>
            <span className="onb-detected-icon">
              <KeyRound size={15} />
            </span>
            <span className="onb-detected-body">
              <strong>Detectada</strong>
              <span className="muted small">{SOURCE_LABELS[detected.source]}</span>
            </span>
            <code className="onb-detected-mask">{mask(detected.key)}</code>
            <button className="btn sm" onClick={onReplace}>
              Usar otra
            </button>
          </div>
          <KeyStatus state={state} name={info.name} onRetry={onRetry} />
        </div>
      ) : (
        <>
          <ol className="onb-steps">
            {info.steps.map((s, i) => (
              <li key={s}>
                <span className="check-num">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
            <li>
              <span className="check-num">{info.steps.length + 1}</span>
              <span>Pégala aquí debajo: se comprueba al momento.</span>
            </li>
          </ol>
          <div className="onb-key">
            <KeyInput value={value} onChange={onChange} state={state} autoFocus={!value} />
            <KeyStatus state={state} name={info.name} onRetry={onRetry} />
            {canRestore && (
              <button className="link small onb-restore" onClick={onRestore}>
                Mantener la key detectada
              </button>
            )}
          </div>
        </>
      )}
      <p className="muted small">Se guarda cifrada en tu equipo y solo se envía a {info.name}.</p>
    </section>
  )
}

function DoneStep({ s, llmOn, localAi }: { s: Settings; llmOn: boolean; localAi: LocalAiState | null }): React.JSX.Element {
  const [mic, setMic] = useState('Predeterminado del sistema')
  useEffect(() => {
    if (!s.micDeviceId) return
    void navigator.mediaDevices.enumerateDevices().then((list) => {
      const dev = list.find((x) => x.deviceId === s.micDeviceId)
      if (dev?.label) setMic(dev.label)
    })
  }, [s.micDeviceId])

  const live = liveProviderFor(s)
  const final = finalProviderFor(s)
  const model = s.llmProvider === 'anthropic' ? s.anthropicModel : s.llmProvider === 'openai' ? s.openaiModel : s.ollamaModel
  const rows: { icon: React.JSX.Element; label: string; value: string; off?: boolean }[] = [
    {
      icon: <AudioLines size={15} />,
      label: 'Transcripción',
      value:
        live === 'none'
          ? `${NAMES[final]} al terminar`
          : live === final
            ? `${NAMES[live]}, en vivo y al terminar`
            : `${NAMES[live]} en vivo · ${NAMES[final]} al terminar`
    },
    {
      icon: <Brain size={15} />,
      label: 'Resúmenes',
      value: !llmOn
        ? 'Sin configurar: añádelo en Configuración > IA para resúmenes'
        : s.llmProvider === 'ollama' && localAi?.status === 'running'
          ? `${NAMES.ollama} · ${localAi.model} · preparándose (${localAiSummary(localAi).toLowerCase()})`
          : `${NAMES[s.llmProvider]} · ${model}`,
      off: !llmOn
    },
    {
      icon: <Globe size={15} />,
      label: 'Idiomas',
      value: s.languages.length ? languageNames(s.languages).replace(/^./, (c) => c.toUpperCase()) : 'Detectar cualquier idioma'
    },
    { icon: <User size={15} />, label: 'Tu nombre', value: s.myName.trim() || 'Yo', off: !s.myName.trim() },
    { icon: <Mic size={15} />, label: 'Micrófono', value: mic }
  ]

  return (
    <>
      <div className="onb-step-head">
        <motion.span
          className="onb-done-mark"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.08 }}
        >
          <Check size={22} strokeWidth={2.6} />
        </motion.span>
        <h1>Todo listo</h1>
        <p className="onb-lead">Puedes cambiar cualquiera de estas opciones más adelante en Configuración.</p>
      </div>
      <section className="card onb-summary">
        {rows.map((r) => (
          <div key={r.label} className="onb-summary-row">
            <span className="onb-summary-icon">{r.icon}</span>
            <span className="onb-summary-label">{r.label}</span>
            <span className={`onb-summary-value ${r.off ? 'off' : ''}`}>{r.value}</span>
          </div>
        ))}
      </section>
    </>
  )
}
