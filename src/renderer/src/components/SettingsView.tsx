import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  AudioLines,
  BookA,
  Brain,
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  KeyRound,
  Mic,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import type {
  ApiKeys,
  FinalProvider,
  LiveProvider,
  LlmProvider,
  PromptTemplate,
  Settings,
  UpdateState
} from '@shared/types'
import { AnimatePresence, motion } from 'motion/react'
import { fadeUp, Field, Spinner, spring, Toggle, useUi } from './ui'
import { CostEstimate } from './CostEstimate'
import { GlossarySettings } from './GlossarySettings'
import { ComboInput, Select } from './Select'
import { knownModels, llmPrice } from '@shared/pricing'

type Tab = 'general' | 'audio' | 'transcription' | 'glossary' | 'ai' | 'prompts' | 'keys'

const TABS: { id: Tab; label: string; icon: React.JSX.Element }[] = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={16} /> },
  { id: 'audio', label: 'Audio', icon: <Mic size={16} /> },
  { id: 'transcription', label: 'Transcripción y hablantes', icon: <AudioLines size={16} /> },
  { id: 'glossary', label: 'Jergas y vocabulario', icon: <BookA size={16} /> },
  { id: 'ai', label: 'IA para resúmenes', icon: <Brain size={16} /> },
  { id: 'prompts', label: 'Prompts', icon: <FileText size={16} /> },
  { id: 'keys', label: 'API keys', icon: <KeyRound size={16} /> }
]

const LANGUAGES = [
  ['multi', 'Varios idiomas (detecta cada cambio)'],
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['ca', 'Catalán'],
  ['pt', 'Portugués'],
  ['fr', 'Francés'],
  ['de', 'Alemán'],
  ['it', 'Italiano']
]

function languageHint(s: Settings): string {
  if (s.language !== 'multi') {
    return 'Fijar el idioma da la máxima precisión si toda la reunión es en ese idioma.'
  }
  const catalanLive = s.liveProvider === 'deepgram'
    ? ' En directo, Deepgram no reconoce el catalán cuando se mezcla con otros idiomas; la pasada final con ElevenLabs sí.'
    : ''
  return `Para reuniones en las que se cambia de idioma sobre la marcha (español, inglés, catalán…). Cada fragmento se transcribe en el idioma en que se dice.${catalanLive}`
}

const LIVE: { id: LiveProvider; name: string; desc: string; key?: keyof ApiKeys; tag?: string }[] = [
  {
    id: 'deepgram',
    name: 'Deepgram',
    key: 'deepgram',
    tag: 'Recomendado',
    desc: 'Separa a las personas en directo (Persona 1, 2, 3…) mientras hablan. Mezcla español, inglés y otros idiomas, pero no reconoce el catalán en ese modo.'
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    key: 'elevenlabs',
    desc: 'Transcripción en vivo muy precisa y con catalán, pero sin separar voces: el audio de la reunión aparece como “Participantes” hasta la pasada final.'
  },
  { id: 'none', name: 'Sin transcripción en vivo', desc: 'Solo se graba; la transcripción aparece al terminar.' }
]

const FINAL: { id: FinalProvider; name: string; desc: string; key?: keyof ApiKeys; tag?: string }[] = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs Scribe v2',
    key: 'elevenlabs',
    tag: 'Recomendado',
    desc: 'La mejor separación de hablantes (hasta 32) y detecta el idioma de cada parte, catalán incluido.'
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    key: 'assemblyai',
    desc: 'Diarización robusta en reuniones con mucha gente (hasta 10 hablantes).'
  },
  { id: 'deepgram', name: 'Deepgram', key: 'deepgram', desc: 'Rápido y económico, con separación de hablantes.' },
  { id: 'none', name: 'No hacer pasada final', desc: 'Se conserva la transcripción en vivo tal cual.' }
]

const KEYS: { id: keyof ApiKeys; name: string; use: string; url: string; steps: string }[] = [
  {
    id: 'deepgram',
    name: 'Deepgram',
    use: 'Transcripción en vivo con hablantes',
    url: 'https://console.deepgram.com/',
    steps: 'Regístrate, entra en tu proyecto y ve a API Keys > Create a New API Key. Incluye crédito gratuito al empezar.'
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    use: 'Transcripción en vivo y final',
    url: 'https://elevenlabs.io/app/developers/api-keys',
    steps: 'Inicia sesión, ve a Developers > API Keys y pulsa Create API Key. Activa el permiso de Speech to Text.'
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    use: 'Transcripción final con hablantes',
    url: 'https://www.assemblyai.com/dashboard/api-keys',
    steps: 'Crea una cuenta y copia la key que aparece en el panel, en la sección API Keys.'
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    use: 'Resúmenes y deducción de nombres',
    url: 'https://platform.claude.com/settings/keys',
    steps: 'Inicia sesión en la consola, ve a Settings > API Keys y pulsa Create Key. Necesitas saldo en Billing.'
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    use: 'Resúmenes y deducción de nombres',
    url: 'https://platform.openai.com/api-keys',
    steps: 'Inicia sesión en la plataforma de desarrolladores y pulsa Create new secret key. Necesitas saldo en Billing.'
  }
]

interface Props {
  settings: Settings
  onChange: (s: Settings) => Promise<void>
  update: UpdateState | null
  recording: boolean
  onInstallUpdate: () => void
}

function modelHint(model: string): string {
  const p = llmPrice(model)
  return p
    ? `${p[0]} $ / ${p[1]} $ por millón de tokens (entrada / salida).`
    : 'Modelo sin precio conocido: no se incluirá en la estimación de coste.'
}

export function SettingsView({ settings, onChange, update, recording, onInstallUpdate }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('general')
  const [s, setS] = useState(settings)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<number>(0)
  const [info, setInfo] = useState<{ version: string; packaged: boolean; libraryDir: string } | null>(null)

  useEffect(() => {
    void window.api.appInfo().then(setInfo)
  }, [])

  const set = (patch: Partial<Settings>): void => {
    const next = { ...s, ...patch }
    setS(next)
    setSaved('saving')
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      void onChange(next).then(() => setSaved('saved'))
    }, 400)
  }
  const setKey = (k: keyof ApiKeys, v: string): void => set({ keys: { ...s.keys, [k]: v } })

  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Configuración</h1>
        <span className={`save-state ${saved}`}>
          {saved === 'saving' ? 'Guardando…' : saved === 'saved' ? (
            <>
              <Check size={14} /> Guardado
            </>
          ) : 'Los cambios se guardan automáticamente'}
        </span>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {tab === t.id && <motion.span layoutId="settings-nav" className="nav-item-bg" transition={spring} />}
              {t.icon} <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} className="settings-content" {...fadeUp} transition={{ duration: 0.18 }}>
          {tab === 'general' && (
            <>
              <section className="card">
                <h2>Tú</h2>
                <Field label="Tu nombre" hint="Se usa para etiquetar tu voz (micrófono) en la transcripción y en los resúmenes.">
                  <input value={s.myName} placeholder="Yo" onChange={(e) => set({ myName: e.target.value })} />
                </Field>
                <Field label="Idioma de las reuniones" hint={languageHint(s)}>
                  <Select
                    value={s.language}
                    options={LANGUAGES.map(([value, label]) => ({ value, label }))}
                    onChange={(language) => set({ language })}
                  />
                </Field>
              </section>
              <section className="card">
                <h2>Personas conocidas</h2>
                <p className="muted small">
                  Nombres que has asignado antes. Aparecen como sugerencias rápidas al identificar a alguien y ayudan a la IA a deducir nombres.
                </p>
                <div className="tags">
                  {s.knownPeople.length === 0 && <span className="muted small">Todavía ninguna.</span>}
                  {s.knownPeople.map((n) => (
                    <span key={n} className="tag removable">
                      {n}
                      <button onClick={() => set({ knownPeople: s.knownPeople.filter((x) => x !== n) })} aria-label={`Quitar ${n}`}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
              <section className="card">
                <h2>
                  <Power size={16} /> Inicio y segundo plano
                </h2>
                <Toggle
                  checked={s.openAtLogin}
                  onChange={(v) => set({ openAtLogin: v })}
                  label="Iniciar con Windows"
                  description={
                    info && !info.packaged
                      ? 'Solo funciona en la versión instalada.'
                      : 'Se abre al encender el ordenador, sin mostrar la ventana: queda en la bandeja del sistema, lista para grabar.'
                  }
                />
                <Toggle
                  checked={s.minimizeToTray}
                  onChange={(v) => set({ minimizeToTray: v })}
                  label="Minimizar a la bandeja del sistema"
                  description="Al minimizar, la ventana desaparece de la barra de tareas y la app sigue junto al reloj. La grabación continúa."
                />
                <Toggle
                  checked={s.closeToTray}
                  onChange={(v) => set({ closeToTray: v })}
                  label="Seguir en segundo plano al cerrar"
                  description="La X oculta la ventana en lugar de salir. Para salir del todo, usa Salir en el icono de la bandeja."
                />
                <p className="muted small">
                  Desde el icono de la bandeja y con clic derecho en el icono de la barra de tareas puedes crear una reunión
                  y empezar a grabar sin abrir la ventana.
                </p>
              </section>
              <section className="card">
                <h2>
                  <Database size={16} /> Datos
                </h2>
                <p className="muted small">
                  Las reuniones, notas y grabaciones se guardan en local, en tu equipo:
                </p>
                <code className="path">{info?.libraryDir}</code>
                <div className="row-actions">
                  <button className="btn" onClick={() => void window.api.openLibrary()}>
                    <FolderOpen size={15} /> Abrir carpeta
                  </button>
                </div>
              </section>
              {update && <UpdateCard update={update} recording={recording} onInstall={onInstallUpdate} />}
            </>
          )}

          {tab === 'audio' && <AudioSettings s={s} set={set} />}

          {tab === 'transcription' && (
            <>
              <CostEstimate s={s} set={set} />
              <section className="card">
                <h2>Transcripción en vivo</h2>
                <p className="muted small">Lo que ves mientras la reunión está en curso.</p>
                <ProviderCards options={LIVE} value={s.liveProvider} keys={s.keys} onChange={(v) => set({ liveProvider: v })} onMissingKey={() => setTab('keys')} />
              </section>
              <section className="card">
                <h2>Transcripción final</h2>
                <p className="muted small">
                  Al detener la grabación se procesa el audio completo con un modelo más preciso para separar a
                  cada persona. Los nombres que hayas asignado en directo se trasladan automáticamente.
                </p>
                <ProviderCards options={FINAL} value={s.finalProvider} keys={s.keys} onChange={(v) => set({ finalProvider: v })} onMissingKey={() => setTab('keys')} />
              </section>
              <section className="card">
                <h2>Ajustes de hablantes</h2>
                <Field label="Personas en la reunión, contándote a ti" hint="Déjalo vacío para que se detecte solo. Indicarlo mejora mucho la separación cuando lo sabes.">
                  <input
                    type="number"
                    min={1}
                    max={32}
                    placeholder="Automático"
                    value={s.expectedSpeakers ?? ''}
                    onChange={(e) => set({ expectedSpeakers: e.target.value ? Number(e.target.value) : null })}
                  />
                </Field>
                <p className="muted small">
                  Para que se reconozcan mejor productos, siglas o jergas, añádelos en{' '}
                  <button className="link" onClick={() => setTab('glossary')}>
                    Jergas y vocabulario
                  </button>
                  . También se usan los nombres de las personas conocidas.
                </p>
                <Field label="Modelo de Deepgram">
                  <input value={s.deepgramModel} onChange={(e) => set({ deepgramModel: e.target.value })} />
                </Field>
              </section>
            </>
          )}

          {tab === 'glossary' && <GlossarySettings glossary={s.glossary} onChange={(glossary) => set({ glossary })} />}

          {tab === 'ai' && (
            <>
            <CostEstimate s={s} set={set} />
            <section className="card">
              <h2>Proveedor de IA</h2>
              <p className="muted small">Se usa para generar resúmenes y para sugerir el nombre de cada persona a partir de la conversación.</p>
              <div className="segmented">
                {(
                  [
                    ['anthropic', 'Claude (Anthropic)'],
                    ['openai', 'ChatGPT (OpenAI)']
                  ] as [LlmProvider, string][]
                ).map(([id, name]) => (
                  <button key={id} className={s.llmProvider === id ? 'active' : ''} onClick={() => set({ llmProvider: id })}>
                    {s.llmProvider === id && <motion.span layoutId="seg-llm" className="seg-bg" transition={spring} />}
                    <span>{name}</span>
                  </button>
                ))}
              </div>
              {s.llmProvider === 'anthropic' ? (
                <Field label="Modelo de Claude" hint={modelHint(s.anthropicModel)}>
                  <ComboInput value={s.anthropicModel} suggestions={knownModels('claude')} onChange={(anthropicModel) => set({ anthropicModel })} />
                </Field>
              ) : (
                <Field label="Modelo de OpenAI" hint={modelHint(s.openaiModel)}>
                  <ComboInput value={s.openaiModel} suggestions={knownModels('gpt')} onChange={(openaiModel) => set({ openaiModel })} />
                </Field>
              )}
              {!s.keys[s.llmProvider] && (
                <p className="warn small">
                  Falta la API key de {s.llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'}.{' '}
                  <button className="link" onClick={() => setTab('keys')}>
                    Añadirla
                  </button>
                </p>
              )}
            </section>
            </>
          )}

          {tab === 'prompts' && <PromptsSettings s={s} set={set} />}

          {tab === 'keys' && (
            <section className="card">
              <h2>API keys</h2>
              <p className="muted small">Se guardan cifradas con el almacén seguro de Windows y solo se envían a su proveedor.</p>
              {KEYS.map((k) => (
                <KeyField key={k.id} name={k.name} use={k.use} url={k.url} steps={k.steps} value={s.keys[k.id]} onChange={(v) => setKey(k.id, v)} />
              ))}
            </section>
          )}
        </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )

}

function UpdateCard({
  update: u,
  recording,
  onInstall
}: {
  update: UpdateState
  recording: boolean
  onInstall: () => void
}): React.JSX.Element {
  const status: Record<UpdateState['status'], string> = {
    unsupported: 'Las actualizaciones solo funcionan en la versión instalada.',
    idle: 'Se buscan actualizaciones al abrir la app y cada pocas horas.',
    checking: 'Buscando actualizaciones…',
    'up-to-date': 'Tienes la última versión.',
    downloading: `Descargando la versión ${u.version}… ${u.percent ?? 0} %`,
    ready: `La versión ${u.version} está lista. Si no reinicias ahora, se instalará al cerrar la app.`,
    error: `No se ha podido comprobar: ${u.error ?? 'error desconocido'}`
  }
  const busy = u.status === 'checking' || u.status === 'downloading'
  return (
    <section className="card">
      <h2>
        <ArrowDownToLine size={16} /> Actualizaciones
      </h2>
      <p className="small">
        Versión instalada <strong>{u.currentVersion}</strong>
      </p>
      <p className={`muted small update-status ${u.status}`}>
        {busy && <Spinner size={12} />} {status[u.status]}
      </p>
      <div className="row-actions">
        {u.status === 'ready' ? (
          <button className="btn primary" disabled={recording} onClick={onInstall}>
            <RefreshCw size={15} /> {recording ? 'Disponible al terminar la grabación' : 'Reiniciar y actualizar'}
          </button>
        ) : (
          <button
            className="btn"
            disabled={busy || u.status === 'unsupported'}
            onClick={() => void window.api.checkForUpdates()}
          >
            <RefreshCw size={15} /> Buscar actualizaciones
          </button>
        )}
        {u.releaseUrl && (
          <button className="btn ghost" onClick={() => void window.api.openExternal(u.releaseUrl!)}>
            <ExternalLink size={15} /> Novedades
          </button>
        )}
      </div>
    </section>
  )
}

function ProviderCards<T extends string>({
  options,
  value,
  keys,
  onChange,
  onMissingKey
}: {
  options: { id: T; name: string; desc: string; key?: keyof ApiKeys; tag?: string }[]
  value: T
  keys: ApiKeys
  onChange: (v: T) => void
  onMissingKey: () => void
}): React.JSX.Element {
  return (
    <div className="provider-cards">
      {options.map((o) => {
        const missing = o.key && !keys[o.key]
        return (
          <button key={o.id} className={`provider-card ${value === o.id ? 'active' : ''}`} onClick={() => onChange(o.id)}>
            <span className="radio" />
            <span className="pc-body">
              <span className="pc-name">
                {o.name}
                {o.tag && <span className="badge ok">{o.tag}</span>}
              </span>
              <span className="pc-desc">{o.desc}</span>
              {missing && value === o.id && (
                <span className="warn small">
                  Falta la API key.{' '}
                  <span className="link" onClick={(e) => { e.stopPropagation(); onMissingKey() }}>
                    Añadirla
                  </span>
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PromptsSettings({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }): React.JSX.Element {
  const ui = useUi()
  const [selected, setSelected] = useState(s.prompts[0]?.id)
  const current = s.prompts.find((p) => p.id === selected) ?? s.prompts[0]
  const update = (patch: Partial<PromptTemplate>): void =>
    set({ prompts: s.prompts.map((p) => (p.id === current.id ? { ...p, ...patch } : p)) })

  const add = (base?: PromptTemplate): void => {
    const p: PromptTemplate = {
      id: crypto.randomUUID(),
      name: base ? `${base.name} (copia)` : 'Nuevo prompt',
      content: base?.content ?? ''
    }
    set({ prompts: [...s.prompts, p] })
    setSelected(p.id)
  }
  const remove = async (): Promise<void> => {
    if (!(await ui.confirm('Eliminar prompt', `Se eliminará “${current.name}”.`, { confirmLabel: 'Eliminar', danger: true })))
      return
    const prompts = s.prompts.filter((p) => p.id !== current.id)
    set({ prompts, defaultPromptId: s.defaultPromptId === current.id ? prompts[0].id : s.defaultPromptId })
    setSelected(prompts[0].id)
  }
  const restore = async (): Promise<void> => {
    const d = await window.api.getDefaults()
    const orig = d.prompts.find((p) => p.id === current.id)
    if (orig) update({ content: orig.content, name: orig.name })
  }

  return (
    <>
      <section className="card">
        <h2>Plantillas de resumen</h2>
        <p className="muted small">
          Elige la plantilla al generar cada resumen. La transcripción (con nombres) y tus notas se envían junto al prompt.
        </p>
        <div className="prompts-layout">
          <div className="prompt-list">
            {s.prompts.map((p) => (
              <button key={p.id} className={`prompt-item ${p.id === current.id ? 'active' : ''}`} onClick={() => setSelected(p.id)}>
                <FileText size={14} />
                <span>{p.name}</span>
                {p.id === s.defaultPromptId && <span className="badge">Por defecto</span>}
              </button>
            ))}
            <button className="btn ghost sm" onClick={() => add()}>
              <Plus size={14} /> Nuevo prompt
            </button>
          </div>
          {current && (
            <div className="prompt-editor">
              <Field label="Nombre">
                <input value={current.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              <Field label="Instrucciones">
                <textarea rows={14} value={current.content} onChange={(e) => update({ content: e.target.value })} />
              </Field>
              <div className="row-actions">
                {current.id !== s.defaultPromptId && (
                  <button className="btn sm" onClick={() => set({ defaultPromptId: current.id })}>
                    <Check size={14} /> Usar por defecto
                  </button>
                )}
                <button className="btn sm" onClick={() => add(current)}>
                  <Copy size={14} /> Duplicar
                </button>
                {current.builtin ? (
                  <button className="btn sm" onClick={() => void restore()}>
                    <RotateCcw size={14} /> Restaurar original
                  </button>
                ) : (
                  <button className="btn sm danger-text" onClick={() => void remove()}>
                    <Trash2 size={14} /> Eliminar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="card">
        <h2>Prompt de identificación de personas</h2>
        <p className="muted small">Se usa en “Identificar con IA” para deducir quién es Persona 1, 2, 3… a partir de la conversación.</p>
        <textarea rows={8} value={s.speakerIdPrompt} onChange={(e) => set({ speakerIdPrompt: e.target.value })} />
        <div className="row-actions">
          <button
            className="btn sm"
            onClick={() => void window.api.getDefaults().then((d) => set({ speakerIdPrompt: d.speakerIdPrompt }))}
          >
            <RotateCcw size={14} /> Restaurar original
          </button>
        </div>
      </section>
    </>
  )
}

function KeyField({
  name,
  use,
  url,
  steps,
  value,
  onChange
}: {
  name: string
  use: string
  url: string
  steps: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  return (
    <div className="key-field">
      <div className="key-head">
        <span className="key-name">{name}</span>
        {value ? (
          <span className="badge ok">
            <Check size={12} /> Configurada
          </span>
        ) : (
          <span className="badge">Sin configurar</span>
        )}
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => void window.api.openExternal(url)} title={url}>
          {value ? 'Gestionar keys' : 'Conseguir API key'} <ExternalLink size={13} />
        </button>
      </div>
      <span className="muted small">{use}</span>
      {!value && <span className="key-steps">{steps}</span>}
      <div className="key-input">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder="Pega aquí la API key"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar' : 'Mostrar'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )
}

function AudioSettings({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }): React.JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [level, setLevel] = useState<number | null>(null)
  const stopTest = useRef<(() => void) | null>(null)

  const load = async (): Promise<void> => {
    const list = await navigator.mediaDevices.enumerateDevices()
    setDevices(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'))
  }
  useEffect(() => {
    void load()
    return () => stopTest.current?.()
  }, [])

  const test = async (): Promise<void> => {
    if (stopTest.current) {
      stopTest.current()
      return
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: s.micDeviceId ? { exact: s.micDeviceId } : undefined }
    })
    void load() // con permiso concedido ya aparecen los nombres de los dispositivos
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(an)
    const data = new Float32Array(an.fftSize)
    let raf = 0
    const tick = (): void => {
      an.getFloatTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += v * v
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 5))
      raf = requestAnimationFrame(tick)
    }
    tick()
    stopTest.current = () => {
      cancelAnimationFrame(raf)
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      setLevel(null)
      stopTest.current = null
    }
  }

  return (
    <>
      <section className="card">
        <h2>Micrófono</h2>
        <Field label="Dispositivo de entrada">
          <Select
            value={s.micDeviceId}
            options={[
              { value: '', label: 'Predeterminado del sistema' },
              ...devices
                .filter((d) => d.deviceId !== 'default')
                .map((d) => ({ value: d.deviceId, label: d.label || 'Micrófono' }))
            ]}
            onChange={(micDeviceId) => set({ micDeviceId })}
          />
        </Field>
        <div className="mic-test">
          <button className="btn sm" onClick={() => void test()}>
            <Mic size={14} /> {level === null ? 'Probar micrófono' : 'Detener prueba'}
          </button>
          <span className="meter wide">
            <span style={{ width: `${(level ?? 0) * 100}%` }} />
          </span>
        </div>
      </section>
      <section className="card">
        <h2>Separación de tu voz</h2>
        <Toggle
          checked={s.separateMic}
          onChange={(v) => set({ separateMic: v })}
          label="Tratar el micrófono como “yo”"
          description="Transcribe tu micrófono y el audio de la llamada por separado: lo que digas tú siempre aparece con tu nombre y el resto de voces se separan en Persona 1, 2, 3… Recomendado con auriculares. Desactívalo en reuniones presenciales con varias personas alrededor del mismo micrófono."
        />
        <p className="muted small">
          El audio de la llamada se captura del sistema, así que funciona con cualquier aplicación: Teams, Google Meet,
          Zoom, Discord, Slack, WhatsApp o el navegador.
        </p>
      </section>
    </>
  )
}
