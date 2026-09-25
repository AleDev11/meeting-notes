import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, Check, ChevronDown, Cpu, ExternalLink, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react'
import type { LocalAiDetection, LocalAiStage, LocalAiState, OllamaStatus, Settings } from '@shared/types'
import { DEFAULT_OLLAMA_URL, LOCAL_MODELS } from '@shared/types'
import { Field, soft, Spinner } from './ui'
import { Select } from './Select'

// ---------------- estado compartido ----------------

/** Estado de la activación de la IA local (vive en el proceso principal). */
export function useLocalAi(): LocalAiState | null {
  const [state, setState] = useState<LocalAiState | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.localAiState().then((s) => alive && setState(s))
    const off = window.api.onLocalAiState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** Qué hay en el equipo; se vuelve a mirar al cambiar la dirección o al terminar una activación. */
function useDetection(url: string, status: LocalAiState['status'] | undefined): [LocalAiDetection | null, () => void] {
  const [det, setDet] = useState<LocalAiDetection | null>(null)
  const refresh = useCallback(() => void window.api.localAiDetect().then(setDet), [])
  useEffect(() => {
    if (status === 'running') return
    const t = window.setTimeout(refresh, 300)
    return () => clearTimeout(t)
  }, [url, status, refresh])
  return [det, refresh]
}

// ---------------- formato ----------------

const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

export function bytes(n: number): string {
  if (n >= 1e9) return `${nf1.format(n / 1e9)} GB`
  if (n >= 1e6) return `${nf0.format(n / 1e6)} MB`
  return `${nf0.format(n / 1e3)} KB`
}

const speed = (bps: number): string => (bps >= 1e6 ? `${nf1.format(bps / 1e6)} MB/s` : `${nf0.format(bps / 1e3)} KB/s`)

function eta(left: number, bps: number): string {
  if (bps < 1e4) return ''
  const s = left / bps
  if (s < 60) return 'menos de 1 min'
  if (s < 3600) return `quedan ${Math.ceil(s / 60)} min`
  const h = Math.floor(s / 3600)
  return `quedan ${h} h ${Math.round((s - h * 3600) / 60)} min`
}

const modelBytes = (model: string): number => LOCAL_MODELS.find((m) => m.name === model)?.bytes ?? 0
/** Tamaño del instalador si no se ha podido consultar (v0.34, septiembre de 2026). */
const INSTALLER_FALLBACK = 1.6e9

export const STAGE_LABELS: Record<LocalAiStage, string> = {
  download: 'Descargar Ollama',
  install: 'Instalar',
  start: 'Iniciar',
  model: 'Descargar modelo',
  done: 'Listo'
}
const STAGES: LocalAiStage[] = ['download', 'install', 'start', 'model', 'done']

/** Porcentaje del paso actual, para indicadores compactos. */
export function localAiPercent(st: LocalAiState): number | null {
  return st.progress?.total ? Math.min(100, Math.floor((st.progress.done / st.progress.total) * 100)) : null
}

/** Resumen de una línea del estado en curso ("Descargando modelo · 45 %"). */
export function localAiSummary(st: LocalAiState): string {
  const pct = localAiPercent(st)
  const name = st.stage ? STAGE_LABELS[st.stage] : 'Comprobando el equipo'
  return pct === null ? name : `${name} · ${pct} %`
}

// ---------------- tarjeta principal ----------------

interface CardProps {
  s: Settings
  set: (p: Partial<Settings>) => void
  /** En el asistente de primer uso: sin opciones avanzadas y con aviso de que se puede seguir. */
  onboarding?: boolean
  onStarted?: (model: string) => void
}

export function LocalAiCard({ s, set, onboarding, onStarted }: CardProps): React.JSX.Element {
  const st = useLocalAi()
  const [det, refresh] = useDetection(s.ollamaUrl, st?.status)
  const [advanced, setAdvanced] = useState(false)

  const running = st?.status === 'running'
  const failed = st?.status === 'error'
  // Lista: acaba de terminar o ya estaba (Ollama en marcha con el modelo configurado).
  const ready =
    st?.status === 'done' ||
    (!running && !failed && !!det?.running && det.models.includes(s.ollamaModel) && (s.llmProvider === 'ollama' || !onboarding))
  const readyModel = st?.status === 'done' ? st.model : s.ollamaModel
  const active = s.llmProvider === 'ollama' && s.ollamaModel === readyModel

  const start = (model?: string): void => {
    void window.api.startLocalAi(model ? { model } : undefined)
    onStarted?.(model ?? det?.recommended ?? st?.model ?? s.ollamaModel)
  }

  return (
    <section className={`card local-ai ${onboarding ? 'onb-panel' : ''}`}>
      <div className="lai-head">
        <span className={`lai-icon ${ready ? 'ok' : ''}`}>
          <Cpu size={17} />
        </span>
        <div className="lai-title">
          <h2>IA local gratis</h2>
          <span className="muted small">Qwen 3.5 con Ollama, en tu equipo</span>
        </div>
        <span className="badge">Sin coste · Privada</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {running || failed ? (
          <motion.div key="progress" className="lai-body" {...fade}>
            <Stepper st={st!} />
            {failed && st!.error && (
              <div className="lai-error" role="alert">
                <AlertTriangle size={15} />
                <span>{st!.error.message}</span>
              </div>
            )}
            <div className="lai-actions">
              {running ? (
                <>
                  <span className="muted small lai-bg-note">
                    {onboarding ? 'Puedes seguir con el asistente: continúa en segundo plano.' : 'Puedes seguir usando la app: continúa en segundo plano.'}
                  </span>
                  <button
                    className="btn"
                    disabled={st!.stage === 'install'}
                    title={st!.stage === 'install' ? 'La instalación no se puede interrumpir a medias' : undefined}
                    onClick={() => void window.api.cancelLocalAi()}
                  >
                    <X size={14} /> Cancelar
                  </button>
                </>
              ) : (
                <>
                  {(st!.error?.code === 'signature' || st!.error?.code === 'installer' || st!.error?.code === 'unsupported') && (
                    <button className="btn ghost" onClick={() => void window.api.openExternal('https://ollama.com/download')}>
                      Instalar a mano <ExternalLink size={13} />
                    </button>
                  )}
                  <span className="grow" />
                  <button className="btn primary" onClick={() => start(st!.model)}>
                    <RotateCcw size={14} /> Reintentar
                  </button>
                </>
              )}
            </div>
          </motion.div>
        ) : ready ? (
          <motion.div key="ready" className="lai-body" {...fade}>
            <div className="lai-ready">
              <motion.span
                className="lai-ready-mark"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              >
                <Check size={16} strokeWidth={2.6} />
              </motion.span>
              <div className="lai-ready-text">
                <strong>
                  Lista <span className="lai-sep">·</span> <code>{readyModel}</code> <span className="lai-sep">·</span> en tu equipo
                </strong>
                <span className="muted small">
                  {active
                    ? 'Los resúmenes y las sugerencias de nombres se generan con Ollama en este ordenador.'
                    : 'Instalada, pero ahora usas otro proveedor para los resúmenes.'}
                </span>
              </div>
              {!active && (
                <button className="btn primary" onClick={() => set({ llmProvider: 'ollama', ollamaModel: readyModel })}>
                  Usar IA local
                </button>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="idle" className="lai-body" {...fade}>
            <p className="small lai-lead">
              Ollama y el modelo se descargan, se instalan y se configuran solos. Sin API key y sin enviar la reunión a internet;
              a cambio, los resúmenes tardan más que en la nube.
            </p>
            <IdlePlan det={det} st={st} />
            <div className="lai-actions">
              <button className="btn primary lg" disabled={!det} onClick={() => start()}>
                {det ? null : <Spinner size={13} />} Activar IA local
              </button>
              <span className="muted small lai-trust">
                <ShieldCheck size={14} /> Instalador oficial, con la firma de Ollama comprobada
              </span>
            </div>
            {st?.cancelled && <p className="muted small">Cancelado. Lo ya descargado del modelo se aprovecha si vuelves a activarla.</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {!onboarding && (
        <>
          <button className={`lai-adv-toggle ${advanced ? 'open' : ''}`} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
            <ChevronDown size={14} /> Opciones avanzadas
          </button>
          <AnimatePresence initial={false}>
            {advanced && (
              <motion.div
                className="lai-adv"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={soft}
              >
                <AdvancedOptions s={s} set={set} busy={running} onDownload={(m) => start(m)} onChecked={refresh} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </section>
  )
}

const fade = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.1 } },
  transition: { duration: 0.2 }
}

function IdlePlan({ det, st }: { det: LocalAiDetection | null; st: LocalAiState | null }): React.JSX.Element {
  if (!det) {
    return (
      <div className="lai-plan">
        <span className="muted small">
          <Spinner size={12} /> Comprobando tu equipo…
        </span>
      </div>
    )
  }
  const model = det.recommended
  const hasModel = det.models.includes(model)
  const installer = det.installed ? 0 : det.installerBytes ?? INSTALLER_FALLBACK
  const download = installer + (hasModel ? 0 : modelBytes(model))
  const status = det.running
    ? hasModel
      ? 'Ollama ya está en marcha con el modelo: solo falta configurarlo.'
      : 'Ollama ya está instalado y en marcha: solo falta el modelo.'
    : det.installed
      ? 'Ollama ya está instalado: se iniciará y se descargará el modelo.'
      : null
  return (
    <div className="lai-plan">
      <div className="lai-plan-row">
        <span className="muted">Modelo para tu equipo</span>
        <span>
          <strong>{model}</strong> <span className="muted">· {bytes(modelBytes(model))} · {det.ramGb} GB de RAM</span>
        </span>
      </div>
      <div className="lai-plan-row">
        <span className="muted">Descarga</span>
        <span>
          {download ? (
            <>
              <strong>{bytes(download)}</strong>
              <span className="muted">
                {' '}
                · {installer ? `Ollama ${bytes(installer)} + modelo` : 'solo el modelo'} · de 10 a 30 min con una conexión normal
              </span>
            </>
          ) : (
            <strong>Nada que descargar</strong>
          )}
        </span>
      </div>
      {status && <p className="small lai-plan-note">{status}</p>}
      {det.note && <p className="small lai-plan-note warn">{det.note}</p>}
    </div>
  )
}

// ---------------- pasos ----------------

function Stepper({ st }: { st: LocalAiState }): React.JSX.Element {
  const current = st.stage ? STAGES.indexOf(st.stage) : -1
  return (
    <ol className="lai-steps">
      {STAGES.map((stage, i) => {
        const skipped = st.skipped.includes(stage)
        const failed = st.status === 'error' && st.stage === stage
        const done = !failed && (skipped || i < current || (stage === 'done' && st.status === 'done'))
        const now = !failed && !done && i === current
        const state = failed ? 'failed' : done ? 'done' : now ? 'active' : 'todo'
        return (
          <li key={stage} className={`lai-step ${state}`}>
            <span className="lai-dot">
              {failed ? <X size={12} strokeWidth={3} /> : done ? <Check size={12} strokeWidth={3} /> : now ? <Spinner size={11} /> : i + 1}
            </span>
            <div className="lai-step-body">
              <div className="lai-step-line">
                <span className="lai-step-name">{STAGE_LABELS[stage]}</span>
                <span className="lai-step-meta">{meta(stage, st, skipped, now, done)}</span>
              </div>
              <AnimatePresence initial={false}>
                {now && (stage === 'download' || stage === 'model') && st.progress && (
                  <motion.div
                    className="lai-progress-wrap"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={soft}
                  >
                    <ProgressBar p={st.progress} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function meta(stage: LocalAiStage, st: LocalAiState, skipped: boolean, now: boolean, done: boolean): string {
  if (skipped) return stage === 'model' ? `${st.model} ya descargado` : stage === 'start' ? 'Ya en marcha' : 'Ya instalado'
  if (now && st.detail && stage !== 'download' && stage !== 'model') return st.detail
  if (stage === 'model') return `${st.model} · ${bytes(st.progress?.total && st.stage === 'model' ? st.progress.total : modelBytes(st.model))}`
  if (stage === 'install' && !done) return 'Sin permisos de administrador'
  return ''
}

function ProgressBar({ p }: { p: { done: number; total: number; bytesPerSec: number } }): React.JSX.Element {
  const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0
  return (
    <div className="lai-progress">
      <div className={`lai-bar ${p.total ? '' : 'indeterminate'}`}>
        <span style={{ transform: `scaleX(${p.total ? pct / 100 : 0.3})` }} />
      </div>
      <div className="lai-progress-text">
        <span>
          {p.total ? (
            <>
              <strong>{bytes(p.done)}</strong> de {bytes(p.total)}
            </>
          ) : p.done ? (
            bytes(p.done)
          ) : (
            'Conectando…'
          )}
        </span>
        <span className="muted">
          {[p.bytesPerSec ? speed(p.bytesPerSec) : '', p.total ? eta(p.total - p.done, p.bytesPerSec) : ''].filter(Boolean).join(' · ')}
        </span>
        <span className="lai-pct">{p.total ? `${Math.floor(pct)} %` : ''}</span>
      </div>
    </div>
  )
}

// ---------------- opciones avanzadas ----------------

function AdvancedOptions({
  s,
  set,
  busy,
  onDownload,
  onChecked
}: {
  s: Settings
  set: (p: Partial<Settings>) => void
  busy: boolean
  onDownload: (model: string) => void
  onChecked: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(
    async (url: string): Promise<void> => {
      setChecking(true)
      try {
        setStatus(await window.api.ollamaStatus(url))
        onChecked()
      } finally {
        setChecking(false)
      }
    },
    [onChecked]
  )
  useEffect(() => {
    if (busy) return
    const t = window.setTimeout(() => void check(s.ollamaUrl), 500)
    return () => clearTimeout(t)
  }, [s.ollamaUrl, busy, check])

  const installed = status?.models ?? []
  const has = (name: string): boolean => installed.some((m) => m.name === name)
  const options = [
    ...LOCAL_MODELS.map((m) => ({
      value: m.name,
      label: `${m.name} · ${bytes(m.bytes)} · ${m.ram}${has(m.name) ? ' · descargado' : ''}`
    })),
    ...installed
      .filter((m) => !LOCAL_MODELS.some((x) => x.name === m.name))
      .map((m) => ({ value: m.name, label: [m.name, m.parameterSize, bytes(m.size), 'descargado'].filter(Boolean).join(' · ') }))
  ]
  if (s.ollamaModel && !options.some((o) => o.value === s.ollamaModel)) options.push({ value: s.ollamaModel, label: s.ollamaModel })

  return (
    <div className="lai-adv-inner">
      <Field label="Dirección de Ollama" hint={`Normalmente ${DEFAULT_OLLAMA_URL}. Cámbiala solo si usas Ollama en otro equipo.`}>
        <input value={s.ollamaUrl} spellCheck={false} placeholder={DEFAULT_OLLAMA_URL} onChange={(e) => set({ ollamaUrl: e.target.value })} />
      </Field>
      <div className="ollama-status">
        <span className={`dot ${status?.ok ? 'ok' : status ? 'off' : ''}`} />
        <span className="small">
          {!status
            ? 'Comprobando…'
            : status.ok
              ? `Ollama en marcha · ${installed.length === 1 ? '1 modelo descargado' : `${installed.length} modelos descargados`}`
              : 'Ollama no responde en esa dirección'}
        </span>
        <button className="btn ghost sm" disabled={checking} onClick={() => void check(s.ollamaUrl)}>
          {checking ? <Spinner size={12} /> : <RefreshCw size={13} />} Comprobar
        </button>
      </div>
      <Field
        label="Modelo"
        hint={
          status?.ok && s.ollamaModel && !has(s.ollamaModel) ? (
            <span className="lai-missing">
              <span className="warn">“{s.ollamaModel}” no está descargado.</span>
              <button className="btn sm" disabled={busy} onClick={() => onDownload(s.ollamaModel)}>
                Descargar {s.ollamaModel}
              </button>
            </span>
          ) : (
            'Los modelos mayores escriben mejor pero piden más memoria y tardan más.'
          )
        }
      >
        <Select value={s.ollamaModel} options={options} onChange={(ollamaModel) => set({ ollamaModel })} />
      </Field>
    </div>
  )
}

// ---------------- indicador compacto ----------------

/** Aviso en la barra lateral mientras se prepara la IA local; lleva a Configuración. */
export function LocalAiPill({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const st = useLocalAi()
  const show = st?.status === 'running' || st?.status === 'error'
  const pct = st ? localAiPercent(st) : null
  return (
    <AnimatePresence initial={false}>
      {show && st && (
        <motion.button
          key="local-ai"
          className={`lai-pill ${st.status === 'error' ? 'error' : ''}`}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 32 }}
          exit={{ opacity: 0, height: 0 }}
          transition={soft}
          title="Ver el progreso en Configuración"
          onClick={onOpen}
        >
          {st.status === 'error' ? <AlertTriangle size={14} /> : <Spinner size={13} />}
          <span className="lai-pill-text">{st.status === 'error' ? 'IA local: no se ha podido activar' : `IA local · ${localAiSummary(st)}`}</span>
          {pct !== null && st.status === 'running' && (
            <span className="lai-pill-bar" style={{ transform: `scaleX(${pct / 100})` }} />
          )}
        </motion.button>
      )}
    </AnimatePresence>
  )
}
