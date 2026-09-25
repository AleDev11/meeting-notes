import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookA, Plus, Search, Trash2, X } from 'lucide-react'
import type { GlossaryEntry } from '@shared/types'
import { cleanTerm, findEntry, normalizeGlossary, termKey } from '@shared/glossary'
import { Select } from './Select'
import { useUi } from './ui'
import '../glossary.css'

type Sort = 'az' | 'recent'

const fold = (t: string): string =>
  t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Pestaña "Jergas y vocabulario" de la configuración. */
export function GlossarySettings({
  glossary,
  onChange
}: {
  glossary: GlossaryEntry[]
  onChange: (g: GlossaryEntry[]) => void
}): React.JSX.Element {
  const ui = useUi()
  const [term, setTerm] = useState('')
  const [meaning, setMeaning] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('az')
  const [flash, setFlash] = useState<string | null>(null)
  const meaningInput = useRef<HTMLInputElement>(null)
  const termInput = useRef<HTMLInputElement>(null)

  // Las filas son memo: las acciones leen siempre la lista más reciente.
  const latest = useRef({ glossary, onChange })
  latest.current = { glossary, onChange }

  const existing = findEntry(glossary, term)

  const add = (): void => {
    const t = cleanTerm(term)
    if (!t) return termInput.current?.focus()
    const m = meaning.trim()
    const list = existing
      ? glossary.map((e) => (e === existing ? { ...e, meaning: m || e.meaning } : e))
      : [...glossary, { term: t, meaning: m }]
    onChange(normalizeGlossary(list))
    setFlash(termKey(t))
    setTerm('')
    setMeaning('')
    termInput.current?.focus()
  }

  const commit = useCallback((key: string, next: GlossaryEntry): boolean => {
    const { glossary: list, onChange: save } = latest.current
    const t = cleanTerm(next.term)
    if (!t) return false
    if (termKey(t) !== key && findEntry(list, t)) {
      ui.toast(`“${t}” ya está en la lista.`, 'info')
      return false
    }
    save(list.map((e) => (termKey(e.term) === key ? { term: t, meaning: next.meaning.trim() } : e)))
    return true
  }, [ui])

  const remove = useCallback((key: string) => {
    const { glossary: list, onChange: save } = latest.current
    save(list.filter((e) => termKey(e.term) !== key))
  }, [])

  const visible = useMemo(() => {
    const q = fold(query.trim())
    const list = q ? glossary.filter((e) => fold(e.term).includes(q) || fold(e.meaning).includes(q)) : glossary
    return sort === 'az'
      ? [...list].sort((a, b) => a.term.localeCompare(b.term, 'es', { sensitivity: 'base' }))
      : [...list].reverse()
  }, [glossary, query, sort])

  const withMeaning = glossary.filter((e) => e.meaning.trim()).length

  return (
    <>
      <section className="card">
        <h2>
          <BookA size={16} /> Jergas y vocabulario
        </h2>
        <p className="muted small">
          Palabras propias de tus reuniones: siglas, productos, nombres internos o abreviaturas. Los términos ayudan a que la
          transcripción los reconozca bien, y su significado se explica a la IA al resumir para que no los tome por
          erratas ni palabras cortadas.
        </p>
        <div className="gloss-example">
          <span className="muted small">Por ejemplo:</span>
          <span><b>pre</b> = preproducción</span>
          <span><b>pro</b> = producción</span>
          <span><b>PR</b> = pull request</span>
        </div>
        <p className="muted small">
          También puedes añadirlos desde la transcripción: selecciona el texto y usa el clic derecho.
        </p>
      </section>

      <section className="card">
        <div className="gloss-add">
          <input
            ref={termInput}
            value={term}
            placeholder="Término"
            spellCheck={false}
            maxLength={60}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && term.trim()) meaningInput.current?.focus()
            }}
          />
          <input
            ref={meaningInput}
            value={meaning}
            placeholder={existing?.meaning || 'Significado (opcional)'}
            onChange={(e) => setMeaning(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <button className="btn primary" onClick={add} disabled={!term.trim()}>
            <Plus size={15} /> {existing ? 'Actualizar' : 'Añadir'}
          </button>
        </div>
        {existing && (
          <p className="small warn gloss-dup">
            “{existing.term}” ya está en la lista
            {existing.meaning ? ` como “${existing.meaning}”` : ' sin significado'}. Al guardar se actualiza su significado.
          </p>
        )}

        <div className="gloss-toolbar">
          {glossary.length > 8 && (
            <div className="gloss-search">
              <Search size={14} />
              <input value={query} placeholder="Buscar" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="Borrar búsqueda">
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          <span className="muted small grow">
            {glossary.length === 1 ? '1 término' : `${glossary.length} términos`}
            {glossary.length > 0 && `, ${withMeaning} con significado`}
          </span>
          {glossary.length > 1 && (
            <Select
              value={sort}
              variant="ghost"
              align="right"
              options={[
                { value: 'az', label: 'A–Z' },
                { value: 'recent', label: 'Recientes primero' }
              ]}
              onChange={setSort}
            />
          )}
        </div>

        {glossary.length === 0 ? (
          <p className="muted small gloss-empty">Todavía no hay términos.</p>
        ) : visible.length === 0 ? (
          <p className="muted small gloss-empty">Nada coincide con “{query}”.</p>
        ) : (
          <div className="gloss-list">
            <div className="gloss-row gloss-head">
              <span>Término</span>
              <span>Significado</span>
            </div>
            {visible.map((e) => {
              const key = termKey(e.term)
              return (
                <GlossaryRow
                  key={key}
                  id={key}
                  entry={e}
                  flash={flash === key}
                  onCommit={commit}
                  onDelete={remove}
                />
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

const GlossaryRow = memo(function GlossaryRow({
  id,
  entry,
  flash,
  onCommit,
  onDelete
}: {
  id: string
  entry: GlossaryEntry
  flash: boolean
  onCommit: (key: string, next: GlossaryEntry) => boolean
  onDelete: (key: string) => void
}): React.JSX.Element {
  const [term, setTerm] = useState(entry.term)
  const [meaning, setMeaning] = useState(entry.meaning)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTerm(entry.term)
    setMeaning(entry.meaning)
  }, [entry.term, entry.meaning])

  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [flash])

  const save = (): void => {
    if (term === entry.term && meaning === entry.meaning) return
    if (!onCommit(id, { term, meaning })) {
      setTerm(entry.term)
      setMeaning(entry.meaning)
    }
  }
  const keys = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      setTerm(entry.term)
      setMeaning(entry.meaning)
      // Sin cambios pendientes al salir del campo.
      requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
    }
  }

  return (
    <div ref={ref} className={`gloss-row ${flash ? 'flash' : ''}`}>
      <input
        className="gloss-term"
        spellCheck={false}
        value={term}
        maxLength={60}
        aria-label="Término"
        onChange={(e) => setTerm(e.target.value)}
        onBlur={save}
        onKeyDown={keys}
      />
      <input
        value={meaning}
        placeholder="Sin significado"
        aria-label={`Significado de ${entry.term}`}
        onChange={(e) => setMeaning(e.target.value)}
        onBlur={save}
        onKeyDown={keys}
      />
      <button className="icon-btn sm gloss-del" onClick={() => onDelete(id)} aria-label={`Quitar ${entry.term}`} title="Quitar">
        <Trash2 size={14} />
      </button>
    </div>
  )
})
