import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { quick } from './ui'

export interface SelectOption<T extends string> {
  value: T
  label: string
  hint?: string
}

/** Lista desplegable con las opciones; compartida por Select y ComboInput. */
function OptionList<T extends string>(p: {
  options: SelectOption<T>[]
  value: string
  active: number
  onActive: (i: number) => void
  onPick: (v: T) => void
  align: 'left' | 'right'
}): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  // Si no cabe debajo del campo, se abre hacia arriba.
  const [up, setUp] = useState(false)
  useLayoutEffect(() => {
    const anchor = list.current?.parentElement?.getBoundingClientRect()
    const height = list.current?.offsetHeight ?? 0
    if (anchor) setUp(window.innerHeight - anchor.bottom < height + 12 && anchor.top > window.innerHeight - anchor.bottom)
  }, [])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${p.active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [p.active])
  return (
    <motion.div
      ref={list}
      role="listbox"
      className={`popover popover-${p.align} select-list ${up ? 'drop-up' : ''}`}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2, pointerEvents: 'none', transition: { duration: 0.1 } }}
      transition={quick}
    >
      {p.options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === p.value}
          data-i={i}
          className={`select-option ${i === p.active ? 'active' : ''}`}
          onMouseEnter={() => p.onActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => p.onPick(o.value)}
        >
          <span className="mi-label">{o.label}</span>
          {o.hint && <span className="mi-hint">{o.hint}</span>}
          <span className="select-check">{o.value === p.value && <Check size={13} />}</span>
        </button>
      ))}
    </motion.div>
  )
}

/** Cierra al hacer clic fuera del elemento. */
function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, open, close])
}

/** Navegación con teclado común: flechas, Intro y Escape. */
function listKeys<T extends string>(
  e: React.KeyboardEvent,
  s: { open: boolean; setOpen: (v: boolean) => void; active: number; setActive: (i: number) => void; options: SelectOption<T>[]; pick: (v: T) => void }
): void {
  const n = s.options.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!s.open) return s.setOpen(true)
    if (n) s.setActive((s.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
  } else if (e.key === 'Enter' && s.open && s.options[s.active]) {
    e.preventDefault()
    s.pick(s.options[s.active].value)
  } else if (e.key === 'Escape' && s.open) {
    e.stopPropagation()
    s.setOpen(false)
  }
}

/**
 * Selector con el estilo de la app en lugar del desplegable nativo del sistema.
 * variant "ghost" es la versión compacta sin borde (barras y cabeceras).
 */
export function Select<T extends string>(p: {
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  disabled?: boolean
  title?: string
  variant?: 'field' | 'ghost'
  align?: 'left' | 'right'
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const current = Math.max(0, p.options.findIndex((o) => o.value === p.value))
  const [active, setActive] = useState(current)
  const root = useRef<HTMLSpanElement>(null)
  const close = (): void => setOpen(false)
  useOutside(root, open, close)
  useEffect(() => {
    if (open) setActive(current)
  }, [open, current])

  const pick = (v: T): void => {
    setOpen(false)
    if (v !== p.value) p.onChange(v)
  }

  return (
    <span className={`select anchor ${p.className ?? ''}`} ref={root}>
      <button
        type="button"
        className={`select-trigger ${p.variant ?? 'field'} ${open ? 'open' : ''}`}
        disabled={p.disabled}
        title={p.title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => listKeys(e, { open, setOpen, active, setActive, options: p.options, pick })}
      >
        <span className="select-value">{p.options[current]?.label ?? p.value}</span>
        <ChevronDown size={13} className="select-chevron" />
      </button>
      <AnimatePresence>
        {open && (
          <OptionList options={p.options} value={p.value} active={active} onActive={setActive} onPick={pick} align={p.align ?? 'left'} />
        )}
      </AnimatePresence>
    </span>
  )
}

/**
 * Campo de texto libre con sugerencias (p. ej. el modelo de IA: hay una lista de
 * conocidos, pero se puede escribir cualquier otro).
 */
export function ComboInput(p: {
  value: string
  suggestions: string[]
  onChange: (v: string) => void
  placeholder?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [typed, setTyped] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const close = (): void => setOpen(false)
  useOutside(root, open, close)

  // Mientras se escribe se filtra; al abrir con la flecha se ven todas.
  const q = typed ? p.value.trim().toLowerCase() : ''
  const options = p.suggestions.filter((s) => s.toLowerCase().includes(q)).map((s) => ({ value: s, label: s }))
  const pick = (v: string): void => {
    setOpen(false)
    setTyped(false)
    p.onChange(v)
  }

  return (
    <span className="select combo anchor" ref={root}>
      <input
        value={p.value}
        placeholder={p.placeholder}
        onChange={(e) => {
          p.onChange(e.target.value)
          setTyped(true)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(e) => listKeys(e, { open, setOpen, active, setActive, options, pick })}
        onBlur={() => setTyped(false)}
      />
      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        aria-label="Ver sugerencias"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setTyped(false)
          setActive(Math.max(0, p.suggestions.indexOf(p.value)))
          setOpen(!open)
        }}
      >
        <ChevronDown size={13} />
      </button>
      <AnimatePresence>
        {open && options.length > 0 && (
          <OptionList options={options} value={p.value} active={active} onActive={setActive} onPick={pick} align="left" />
        )}
      </AnimatePresence>
    </span>
  )
}
