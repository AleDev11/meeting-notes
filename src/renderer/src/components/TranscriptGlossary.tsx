import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BookPlus, Copy } from 'lucide-react'
import type { GlossaryEntry, TranscriptSegment } from '@shared/types'
import { cleanTerm, findEntry, normalizeGlossary, termKey, termMatcher, type TermMatcher } from '@shared/glossary'
import { MenuItem, Popover, quick, useUi } from './ui'
import '../glossary.css'

export interface GlossPart {
  text: string
  meaning?: string
}

/** Divide un texto marcando los términos de la jerga que tienen significado. */
export function splitGloss(text: string, find: TermMatcher | null, meanings: Map<string, string>): GlossPart[] {
  const matches = find?.(text) ?? []
  if (!matches.length) return [{ text }]
  const out: GlossPart[] = []
  let last = 0
  for (const m of matches) {
    if (m.start > last) out.push({ text: text.slice(last, m.start) })
    out.push({ text: text.slice(m.start, m.end), meaning: meanings.get(m.key) })
    last = m.end
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export interface GlossMarks {
  find: TermMatcher | null
  meanings: Map<string, string>
  /** Fragmentos ya divididos de los segmentos que contienen algún término. */
  bySegment: Map<string, GlossPart[]>
}

/** Precalcula las marcas de la jerga en toda la transcripción (solo cambia con la lista o el texto). */
export function useGlossMarks(glossary: GlossaryEntry[], segments: TranscriptSegment[]): GlossMarks {
  const { find, meanings } = useMemo(() => {
    const withMeaning = glossary.filter((e) => e.meaning.trim())
    return {
      find: termMatcher(withMeaning.map((e) => e.term)),
      meanings: new Map(withMeaning.map((e) => [termKey(e.term), e.meaning.trim()]))
    }
  }, [glossary])
  // Durante la grabación solo se procesan los segmentos nuevos o corregidos.
  const cache = useMemo(() => new Map<string, GlossPart[] | null>(), [find, meanings])
  const bySegment = useMemo(() => {
    const map = new Map<string, GlossPart[]>()
    if (!find) return map
    for (const s of segments) {
      const k = `${s.id}\u0000${s.text}`
      let parts = cache.get(k)
      if (parts === undefined) {
        const split = splitGloss(s.text, find, meanings)
        parts = split.length > 1 || split[0].meaning ? split : null
        cache.set(k, parts)
      }
      if (parts) map.set(s.id, parts)
    }
    return map
  }, [segments, find, meanings, cache])
  return { find, meanings, bySegment }
}

export function GlossText({ parts }: { parts: GlossPart[] }): React.JSX.Element {
  return (
    <>
      {parts.map((p, i) =>
        p.meaning ? (
          <abbr key={i} className="gloss-mark" title={p.meaning}>
            {p.text}
          </abbr>
        ) : (
          p.text
        )
      )}
    </>
  )
}

/** Texto seleccionado listo para usarse como término. */
function asTerm(text: string): string {
  return cleanTerm(text)
    .replace(/^[\s"'“”‘’«»¿¡([{.,;:!?-]+|[\s"'“”‘’«».,;:!?)\]}-]+$/g, '')
    .slice(0, 60)
    .trim()
}

type State = { x: number; y: number; text: string; mode: 'button' | 'menu' | 'add' }

/**
 * Menú sobre el texto seleccionado en la transcripción: clic derecho o el botón
 * flotante permiten añadirlo a las jergas o copiarlo.
 */
export function SelectionMenu({
  container,
  glossary,
  onGlossary
}: {
  container: React.RefObject<HTMLDivElement | null>
  glossary: GlossaryEntry[]
  onGlossary: (g: GlossaryEntry[]) => void
}): React.JSX.Element {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const selection = (): { text: string; rect: DOMRect } | null => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null
      // Al corregir un segmento, el texto seleccionado es del campo de edición.
      if (document.activeElement instanceof HTMLTextAreaElement) return null
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return null
      const text = sel.toString()
      return text.trim() ? { text, rect: range.getBoundingClientRect() } : null
    }
    const onContext = (e: MouseEvent): void => {
      const s = selection()
      if (!s) return
      e.preventDefault()
      setState({ x: e.clientX, y: e.clientY, text: s.text, mode: 'menu' })
    }
    const onUp = (e: MouseEvent): void => {
      // El doble clic es para corregir el segmento: no se ofrece nada.
      if (e.button !== 0 || e.detail > 1) return
      setTimeout(() => {
        const s = selection()
        setState((prev) =>
          prev && prev.mode !== 'button'
            ? prev
            : s
              ? { x: s.rect.right, y: s.rect.bottom, text: s.text, mode: 'button' }
              : null
        )
      })
    }
    const onScroll = (): void => setState((prev) => (prev?.mode === 'button' || prev?.mode === 'menu' ? null : prev))
    const onSelChange = (): void => {
      if (window.getSelection()?.isCollapsed) setState((prev) => (prev?.mode === 'button' ? null : prev))
    }
    el.addEventListener('contextmenu', onContext)
    el.addEventListener('mouseup', onUp)
    el.addEventListener('scroll', onScroll)
    document.addEventListener('selectionchange', onSelChange)
    return () => {
      el.removeEventListener('contextmenu', onContext)
      el.removeEventListener('mouseup', onUp)
      el.removeEventListener('scroll', onScroll)
      document.removeEventListener('selectionchange', onSelChange)
    }
  }, [container])

  const close = (): void => setState(null)
  const term = state ? asTerm(state.text) : ''
  const existing = findEntry(glossary, term)

  // Posición dentro de la ventana; si no cabe debajo, se abre hacia arriba.
  const left = state ? Math.max(8, Math.min(state.x, window.innerWidth - 332)) : 0
  const up = state ? state.y > window.innerHeight - 300 : false

  return (
    <>
      <AnimatePresence>
        {state?.mode === 'button' && (
          <motion.button
            key="sel-float"
            className="sel-float"
            style={{ left: Math.min(state.x + 4, window.innerWidth - 150), top: Math.min(state.y + 6, window.innerHeight - 40) }}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={quick}
            // Sin perder la selección al pulsar.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setState({ ...state, mode: 'add' })}
          >
            <BookPlus size={13} /> Añadir a jergas
          </motion.button>
        )}
      </AnimatePresence>
      <div className="sel-anchor" style={{ left, top: state?.y ?? 0 }}>
        <Popover open={state?.mode === 'menu'} onClose={close} className={`pop-sel ${up ? 'up' : ''}`}>
          <MenuItem icon={<BookPlus size={14} />} onClick={() => state && setState({ ...state, mode: 'add' })}>
            {existing ? 'Editar en jergas…' : 'Añadir a jergas…'}
          </MenuItem>
          <MenuItem
            icon={<Copy size={14} />}
            hint="Ctrl+C"
            onClick={() => {
              if (state) void navigator.clipboard.writeText(state.text)
              close()
            }}
          >
            Copiar
          </MenuItem>
        </Popover>
        <Popover open={state?.mode === 'add'} onClose={close} className={`pop-gloss ${up ? 'up' : ''}`}>
          {state?.mode === 'add' && (
            <AddForm
              key={state.text}
              initial={term}
              glossary={glossary}
              onCancel={close}
              onSave={(g) => {
                onGlossary(g)
                close()
                window.getSelection()?.removeAllRanges()
              }}
            />
          )}
        </Popover>
      </div>
    </>
  )
}

function AddForm({
  initial,
  glossary,
  onSave,
  onCancel
}: {
  initial: string
  glossary: GlossaryEntry[]
  onSave: (g: GlossaryEntry[]) => void
  onCancel: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [term, setTerm] = useState(initial)
  const found = findEntry(glossary, term)
  const [meaning, setMeaning] = useState(found?.meaning ?? '')
  const meaningInput = useRef<HTMLInputElement>(null)

  // Al escribir un término que ya existe se trae su significado para editarlo.
  const lastFound = useRef(found)
  useEffect(() => {
    if (found !== lastFound.current) {
      if (found) setMeaning(found.meaning)
      lastFound.current = found
    }
  }, [found])

  const save = (): void => {
    const t = cleanTerm(term)
    if (!t) return
    const m = meaning.trim()
    const next = found
      ? glossary.map((e) => (e === found ? { ...e, meaning: m } : e))
      : [...glossary, { term: t, meaning: m }]
    onSave(normalizeGlossary(next))
    ui.toast(found ? `Significado de “${found.term}” actualizado.` : `“${t}” añadido a jergas.`, 'success')
  }
  const keys = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className="gloss-form" onKeyDown={keys}>
      <div className="menu-heading">{found ? 'Ya está en jergas' : 'Añadir a jergas'}</div>
      <label className="gloss-form-field">
        <span>Término</span>
        <input value={term} maxLength={60} spellCheck={false} onChange={(e) => setTerm(e.target.value)} />
      </label>
      <label className="gloss-form-field">
        <span>Significado</span>
        <input
          ref={meaningInput}
          autoFocus
          value={meaning}
          placeholder="p. ej. preproducción"
          onChange={(e) => setMeaning(e.target.value)}
        />
      </label>
      {found && (
        <p className="gloss-form-note">
          {found.meaning ? `Ahora significa “${found.meaning}”.` : 'Todavía no tiene significado.'} Puedes cambiarlo aquí.
        </p>
      )}
      <div className="gloss-form-actions">
        <button className="btn ghost sm" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn primary sm" disabled={!cleanTerm(term)} onClick={save}>
          {found ? 'Guardar significado' : 'Añadir'}
        </button>
      </div>
    </div>
  )
}
