import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

// ---------------- motion presets ----------------

export const ease = [0.22, 1, 0.36, 1] as const
export const quick: Transition = { duration: 0.18, ease }
export const soft: Transition = { duration: 0.32, ease }
export const spring: Transition = { type: 'spring', stiffness: 500, damping: 38, mass: 0.7 }

export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 }
}

// ---------------- media query ----------------

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = (): void => setMatches(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

// ---------------- marca ----------------

export function Logo({ size = 22 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="logo" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="7" fill="currentColor" />
      <g stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round">
        <line x1="7.5" y1="10" x2="7.5" y2="14" />
        <line x1="12" y1="7" x2="12" y2="17" />
        <line x1="16.5" y1="9" x2="16.5" y2="15" />
      </g>
    </svg>
  )
}

// ---------------- tabs con indicador animado ----------------

export function Tabs<T extends string>({
  id,
  items,
  value,
  onChange,
  className = ''
}: {
  id: string
  items: { id: T; label: ReactNode; icon?: ReactNode }[]
  value: T
  onChange: (v: T) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={`tab ${value === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          <span>{t.label}</span>
          {value === t.id && <motion.span layoutId={`tab-ind-${id}`} className="tab-indicator" transition={spring} />}
        </button>
      ))}
    </div>
  )
}

// ---------------- popover / menú ----------------

export function Popover({
  open,
  onClose,
  children,
  align = 'left',
  className = ''
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // En el siguiente tick para no cerrar con el mismo clic que abre.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown))
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          className={`popover popover-${align} ${className}`}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -2, pointerEvents: 'none', transition: { duration: 0.1 } }}
          transition={quick}
          style={{ transformOrigin: align === 'right' ? 'top right' : 'top left' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  disabled,
  hint
}: {
  icon?: ReactNode
  children: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  hint?: ReactNode
}): React.JSX.Element {
  return (
    <button className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled}>
      {icon && <span className="mi-icon">{icon}</span>}
      <span className="mi-label">{children}</span>
      {hint && <span className="mi-hint">{hint}</span>}
    </button>
  )
}

// ---------------- controles ----------------

export function Toggle({
  checked,
  onChange,
  label,
  description
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: ReactNode
}): React.JSX.Element {
  return (
    <div className="toggle-row" onClick={() => onChange(!checked)}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`}>
        <motion.span className="knob" layout transition={spring} />
      </button>
    </div>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Spinner({ size = 14 }: { size?: number }): React.JSX.Element {
  return <span className="spinner" style={{ width: size, height: size }} />
}

// ---------------- diálogos y avisos ----------------

type Toast = { id: number; kind: 'error' | 'info' | 'success'; text: string }

interface DialogState {
  kind: 'text' | 'confirm'
  title: string
  message?: string
  initial?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (v: string | boolean | null) => void
}

interface UiApi {
  askText: (title: string, initial?: string) => Promise<string | null>
  confirm: (title: string, message: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>
  toast: (text: string, kind?: Toast['kind']) => void
}

const UiContext = createContext<UiApi | null>(null)

export function useUi(): UiApi {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('UiProvider missing')
  return ctx
}

export function UiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [text, setText] = useState('')
  const nextId = useRef(1)

  const askText = useCallback(
    (title: string, initial = '') =>
      new Promise<string | null>((resolve) => {
        setText(initial)
        setDialog({ kind: 'text', title, initial, resolve: (v) => resolve(v as string | null) })
      }),
    []
  )
  const confirm = useCallback(
    (title: string, message: string, opts: { confirmLabel?: string; danger?: boolean } = {}) =>
      new Promise<boolean>((resolve) =>
        setDialog({ kind: 'confirm', title, message, ...opts, resolve: (v) => resolve(!!v) })
      ),
    []
  )
  const toast = useCallback((t: string, kind: Toast['kind'] = 'error') => {
    const id = nextId.current++
    setToasts((l) => [...l.filter((x) => x.text !== t), { id, kind, text: t }])
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500)
  }, [])
  const api = useMemo(() => ({ askText, confirm, toast }), [askText, confirm, toast])

  const close = (v: string | boolean | null): void => {
    dialog?.resolve(v)
    setDialog(null)
  }
  const submitText = (): void => {
    if (text.trim()) close(text.trim())
  }

  return (
    <UiContext.Provider value={api}>
      {children}

      <AnimatePresence>
        {dialog && (
          <motion.div
            key="dialog"
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={quick}
            onMouseDown={() => close(dialog.kind === 'text' ? null : false)}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={soft}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3>{dialog.title}</h3>
              {dialog.message && <p className="modal-msg">{dialog.message}</p>}
              {dialog.kind === 'text' && (
                <input
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitText()
                    if (e.key === 'Escape') close(null)
                  }}
                />
              )}
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => close(dialog.kind === 'text' ? null : false)}>
                  Cancelar
                </button>
                <button
                  autoFocus={dialog.kind === 'confirm'}
                  className={`btn ${dialog.danger ? 'danger' : 'primary'}`}
                  onClick={() => (dialog.kind === 'text' ? submitText() : close(true))}
                >
                  {dialog.confirmLabel ?? 'Aceptar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="toasts">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast toast-${t.kind}`}
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              transition={soft}
            >
              {t.kind === 'error' ? <AlertCircle size={16} /> : t.kind === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
              <span>{t.text}</span>
              <button className="icon-btn sm" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))} aria-label="Cerrar">
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </UiContext.Provider>
  )
}
