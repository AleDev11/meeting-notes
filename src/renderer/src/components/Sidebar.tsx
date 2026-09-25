import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownToLine,
  ChevronRight,
  Clock,
  FilePlus2,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X
} from 'lucide-react'
import type { Folder, MeetingSummary, SearchResult } from '@shared/types'
import { fmtDate, fmtDuration } from '../util'
import { Select } from './Select'
import { Logo, MenuItem, Popover, quick, soft } from './ui'

export type SortMode = 'manual' | 'recent' | 'name'

interface Props {
  folders: Folder[]
  meetings: MeetingSummary[]
  selectedId: string | null
  recordingId: string | null
  settingsOpen: boolean
  /** highlight: texto buscado, para resaltarlo en la reunión. */
  onSelect: (id: string, highlight?: string) => void
  onNewMeeting: (folderId: string | null) => void
  onNewFolder: (parentId: string | null) => void
  onRenameFolder: (f: Folder) => void
  onDeleteFolder: (f: Folder) => void
  onDeleteMeeting: (m: MeetingSummary) => void
  /** shown: orden visible de la carpeta destino, para recolocar fuera del orden manual. */
  onMoveMeeting: (id: string, folderId: string | null, beforeId: string | null, shown?: string[]) => void
  onMoveFolder: (id: string, parentId: string | null, beforeId: string | null) => void
  /** Carpeta que hay que desplegar y enseñar; se avisa con onRevealed al hacerlo. */
  reveal: string | null
  onRevealed: () => void
  onOpenSettings: () => void
  onCollapse: () => void
  /** Versión descargada y lista para instalar. */
  updateReady: string | null
  onInstallUpdate: () => void
}

/** El índice marca cada coincidencia entre los caracteres U+0001 y U+0002. */
function renderSnippet(snippet: string): React.ReactNode {
  return snippet.split('\u0001').map((part, i) => {
    if (i === 0) return part
    const [hit, rest = ''] = part.split('\u0002')
    return (
      <span key={i}>
        <mark>{hit}</mark>
        {rest}
      </span>
    )
  })
}

const MEETING_MIME = 'application/x-meeting'
const FOLDER_MIME = 'application/x-folder'
const INDENT = 16
const EXPAND_DELAY = 600

type DragItem = { kind: 'meeting' | 'folder'; id: string }
/** Línea de inserción (centro vertical, en coordenadas del árbol) o carpeta de destino. */
type Hint = { kind: 'line'; top: number; depth: number } | { kind: 'into'; id: string }
/** Qué pasará al soltar. reorder: posición exacta (implica orden manual). */
interface DropPlan {
  parentId: string | null
  beforeId: string | null
  reorder?: boolean
}

const sameHint = (a: Hint | null, b: Hint | null): boolean => JSON.stringify(a) === JSON.stringify(b)

export function Sidebar(p: Props): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [menu, setMenu] = useState<string | null>(null)
  const [dragging, setDragging] = useState<DragItem | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragItem | null>(null)
  const planRef = useRef<DropPlan | null>(null)
  const expandRef = useRef<{ id: string; t: number } | null>(null)

  // Reuniones ya ordenadas y agrupadas por carpeta: se calcula una vez por cambio,
  // no en cada render ni por cada carpeta.
  const byFolder = useMemo(() => {
    const sorted = [...p.meetings]
    if (sortMode === 'recent') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else if (sortMode === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title))
    else sorted.sort((a, b) => a.order - b.order)
    const map = new Map<string | null, MeetingSummary[]>()
    for (const m of sorted) map.set(m.folderId, [...(map.get(m.folderId) ?? []), m])
    return map
  }, [p.meetings, sortMode])

  const folderById = useMemo(() => new Map(p.folders.map((f) => [f.id, f])), [p.folders])
  const childFolders = useMemo(() => {
    const map = new Map<string | null, Folder[]>()
    for (const f of [...p.folders].sort((a, b) => a.order - b.order)) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f])
    return map
  }, [p.folders])

  // Reuniones por carpeta, contando las de sus subcarpetas.
  const totals = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of p.meetings)
      for (let c = m.folderId; c; c = folderById.get(c)?.parentId ?? null) map.set(c, (map.get(c) ?? 0) + 1)
    return map
  }, [p.meetings, folderById])

  // Carpetas que contienen la reunión abierta.
  const activePath = useMemo(() => {
    const set = new Set<string>()
    const sel = p.settingsOpen ? undefined : p.meetings.find((m) => m.id === p.selectedId)
    for (let c = sel?.folderId ?? null; c; c = folderById.get(c)?.parentId ?? null) set.add(c)
    return set
  }, [p.meetings, p.selectedId, p.settingsOpen, folderById])

  const q = filter.trim()
  const [results, setResults] = useState<SearchResult[] | null>(null)
  useEffect(() => {
    if (!q) return setResults(null)
    const t = setTimeout(() => void window.api.searchLibrary(q).then(setResults), 120)
    return () => clearTimeout(t)
  }, [q])

  // Enseñar una carpeta pedida desde fuera (la ruta de la reunión abierta).
  useEffect(() => {
    const id = p.reveal
    if (!id) return
    p.onRevealed()
    setFilter('')
    setCollapsed((s) => {
      const n = new Set(s)
      for (let c: string | null = id; c; c = folderById.get(c)?.parentId ?? null) n.delete(c)
      return n
    })
    setFlash(id)
    setTimeout(() => {
      treeRef.current?.querySelector(`[data-folder-row="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 360)
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.reveal])

  const toggle = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // ---------- arrastrar y soltar ----------

  /** Despliega la carpeta si el puntero se queda encima un rato. */
  const arm = (id: string | null): void => {
    const cur = expandRef.current
    if (cur && cur.id === id) return
    if (cur) clearTimeout(cur.t)
    expandRef.current =
      id && collapsed.has(id)
        ? {
            id,
            t: window.setTimeout(() => {
              expandRef.current = null
              setCollapsed((s) => {
                const n = new Set(s)
                n.delete(id)
                return n
              })
            }, EXPAND_DELAY)
          }
        : null
  }

  const endDrag = useCallback((): void => {
    dragRef.current = null
    planRef.current = null
    if (expandRef.current) clearTimeout(expandRef.current.t)
    expandRef.current = null
    setDragging(null)
    setHint(null)
  }, [])

  // dragend llega siempre al terminar: al soltar, con Esc o fuera de la ventana.
  useEffect(() => {
    window.addEventListener('dragend', endDrag, true)
    return () => window.removeEventListener('dragend', endDrag, true)
  }, [endDrag])

  const startDrag = (e: DragEvent, item: DragItem): void => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(item.kind === 'meeting' ? MEETING_MIME : FOLDER_MIME, item.id)
    dragRef.current = item
    setMenu(null)
    // Tras capturar la imagen de arrastre, para que esta no salga atenuada.
    setTimeout(() => dragRef.current === item && setDragging(item), 0)
  }

  const show = (plan: DropPlan | null, next: Hint | null): void => {
    planRef.current = plan
    setHint((prev) => (sameHint(prev, next) ? prev : next))
  }

  const accept = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
  }

  const deny = (e: DragEvent): void => {
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'none'
    show(null, null)
  }

  /** ¿Es id la carpeta ancestor o una de sus descendientes? */
  const within = (id: string | null, ancestor: string): boolean => {
    for (let c = id; c; c = folderById.get(c)?.parentId ?? null) if (c === ancestor) return true
    return false
  }

  /** Borde de un elemento en coordenadas del árbol, centrado en el hueco entre filas. */
  const yIn = (el: Element | null, edge: 'top' | 'bottom'): number => {
    const tree = treeRef.current
    if (!tree || !el) return 2
    const r = el.getBoundingClientRect()
    return Math.round((edge === 'top' ? r.top - 1 : r.bottom + 1) - tree.getBoundingClientRect().top + tree.scrollTop)
  }

  const line = (top: number, depth: number): Hint => ({ kind: 'line', top, depth })

  // Las carpetas van siempre antes que las reuniones: el final de las de la raíz.
  const afterRootFolders = (skip: string): Hint => {
    const last = (childFolders.get(null) ?? []).filter((f) => f.id !== skip).at(-1)
    const el = last ? (treeRef.current?.querySelector(`[data-folder="${last.id}"]`) ?? null) : null
    return line(el ? yIn(el, 'bottom') : 2, 0)
  }

  const overMeeting = (e: DragEvent<HTMLElement>, m: MeetingSummary, depth: number): void => {
    const d = dragRef.current
    if (!d) return
    arm(null)
    if (d.kind === 'folder') {
      if (within(m.folderId, d.id)) return deny(e)
      accept(e)
      return m.folderId
        ? show({ parentId: m.folderId, beforeId: null }, { kind: 'into', id: m.folderId })
        : show({ parentId: null, beforeId: null }, afterRootFolders(d.id))
    }
    accept(e)
    if (d.id === m.id) return show(null, null)
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    const list = (byFolder.get(m.folderId) ?? []).filter((x) => x.id !== d.id)
    const i = list.findIndex((x) => x.id === m.id)
    show(
      { parentId: m.folderId, beforeId: after ? (list[i + 1]?.id ?? null) : m.id, reorder: true },
      line(yIn(el, after ? 'bottom' : 'top'), depth)
    )
  }

  const overFolder = (e: DragEvent<HTMLElement>, f: Folder, depth: number, open: boolean): void => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'folder' && within(f.id, d.id)) {
      arm(null)
      return deny(e)
    }
    accept(e)
    arm(f.id)
    const into = (): void => show({ parentId: f.id, beforeId: null }, { kind: 'into', id: f.id })
    if (d.kind === 'meeting') return into()
    // Franja superior: delante. Inferior: detrás (o la primera dentro si está abierta). Centro: dentro.
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (y < 0.25) return show({ parentId: f.parentId, beforeId: f.id }, line(yIn(el, 'top'), depth))
    if (y <= 0.75) return into()
    const kids = (childFolders.get(f.id) ?? []).filter((x) => x.id !== d.id)
    if (open && (kids.length > 0 || byFolder.has(f.id))) {
      return show({ parentId: f.id, beforeId: kids[0]?.id ?? null }, line(yIn(el, 'bottom'), depth + 1))
    }
    const sibs = (childFolders.get(f.parentId) ?? []).filter((x) => x.id !== d.id)
    const i = sibs.findIndex((x) => x.id === f.id)
    show({ parentId: f.parentId, beforeId: sibs[i + 1]?.id ?? null }, line(yIn(el.parentElement, 'bottom'), depth))
  }

  const overEmpty = (e: DragEvent, f: Folder): void => {
    const d = dragRef.current
    if (!d) return
    arm(null)
    if (d.kind === 'folder' && within(f.id, d.id)) return deny(e)
    accept(e)
    show({ parentId: f.id, beforeId: null }, { kind: 'into', id: f.id })
  }

  // Zona libre al final de la lista: la raíz.
  const overEnd = (e: DragEvent<HTMLElement>): void => {
    const d = dragRef.current
    if (!d) return
    arm(null)
    accept(e)
    if (d.kind === 'folder') return show({ parentId: null, beforeId: null }, afterRootFolders(d.id))
    show({ parentId: null, beforeId: null, reorder: true }, line(yIn(e.currentTarget, 'top'), 0))
  }

  const drop = (e: DragEvent): void => {
    const d = dragRef.current
    const plan = planRef.current
    if (!d) return
    e.preventDefault()
    endDrag()
    if (!plan) return
    if (d.kind === 'folder') return p.onMoveFolder(d.id, plan.parentId, plan.beforeId)
    // Recolocar con otro orden activo: se parte del orden visible y se pasa a manual.
    const shown = plan.reorder && sortMode !== 'manual' ? (byFolder.get(plan.parentId) ?? []).map((m) => m.id) : undefined
    if (shown) setSortMode('manual')
    p.onMoveMeeting(d.id, plan.parentId, plan.beforeId, shown)
  }

  const renderMeetings = (folderId: string | null, depth: number): React.JSX.Element[] =>
    (byFolder.get(folderId) ?? []).map((m) => {
      const recording = m.id === p.recordingId
      const selected = m.id === p.selectedId && !p.settingsOpen
      return (
        <motion.div
          key={m.id}
          className="row-wrap"
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6, transition: { duration: 0.12 } }}
          transition={soft}
        >
          <div
            className={['row row-meeting', selected ? 'selected' : '', dragging?.id === m.id ? 'dragging' : ''].join(' ')}
            style={{ paddingLeft: 8 + depth * INDENT }}
            data-meeting={m.id}
            draggable
            onDragStart={(e) => startDrag(e, { kind: 'meeting', id: m.id })}
            onDragOver={(e) => overMeeting(e, m, depth)}
            onClick={() => p.onSelect(m.id)}
          >
            {selected && <motion.span layoutId="row-selected" className="row-selected-bg" transition={soft} />}
            <span className="row-lead">
              {recording ? (
                <span className="rec-dot" />
              ) : m.status === 'processing' ? (
                <Loader2 size={13} className="spin" />
              ) : m.status === 'pending' ? (
                <Clock size={13} className="row-pending" />
              ) : (
                <span className="row-bullet" />
              )}
            </span>
            <span className="row-body">
              <span className="row-title">{m.title}</span>
              <span className="row-sub">
                {recording ? 'Grabando ahora' : m.status === 'pending' ? 'Pendiente de transcribir' : fmtDate(m.createdAt)}
                {!recording && m.durationSec > 0 && <> · {fmtDuration(m.durationSec)}</>}
              </span>
            </span>
            <button
              className="row-action"
              title="Eliminar reunión"
              onClick={(e) => {
                e.stopPropagation()
                p.onDeleteMeeting(m)
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </motion.div>
      )
    })

  const renderFolders = (parentId: string | null, depth: number): React.JSX.Element[] =>
    (childFolders.get(parentId) ?? []).map((f) => {
      const isOpen = !collapsed.has(f.id) || !!q
      const total = totals.get(f.id) ?? 0
      const isEmpty = !childFolders.has(f.id) && !byFolder.has(f.id)
      const into = hint?.kind === 'into' && hint.id === f.id
      return (
        <motion.div
          key={f.id}
          layout="position"
          transition={soft}
          data-folder={f.id}
          className={[
            'folder-block',
            activePath.has(f.id) ? 'in-path' : '',
            into ? 'drop-into' : '',
            dragging?.id === f.id ? 'dragging' : ''
          ].join(' ')}
        >
          <div
            className={[
              'row row-folder',
              isOpen ? 'open' : '',
              into ? 'drop' : '',
              menu === f.id ? 'menu-open' : '',
              flash === f.id ? 'flash' : ''
            ].join(' ')}
            style={{ paddingLeft: 4 + depth * INDENT }}
            data-folder-row={f.id}
            aria-expanded={isOpen}
            draggable
            onDragStart={(e) => startDrag(e, { kind: 'folder', id: f.id })}
            onDragOver={(e) => overFolder(e, f, depth, isOpen)}
            onClick={() => toggle(f.id)}
            onDoubleClick={() => p.onRenameFolder(f)}
          >
            <motion.span className="row-chev" animate={{ rotate: isOpen ? 90 : 0 }} transition={quick}>
              <ChevronRight size={13} />
            </motion.span>
            {isOpen ? (
              <FolderOpen size={14} className="row-folder-icon" />
            ) : (
              <FolderIcon size={14} className="row-folder-icon" />
            )}
            <span className="row-title">{f.name}</span>
            <span className="row-count" title={`${total} ${total === 1 ? 'reunión' : 'reuniones'}`}>
              {total || ''}
            </span>
            <span className="row-tools">
              <button
                className="row-action"
                title="Nueva reunión en esta carpeta"
                onClick={(e) => {
                  e.stopPropagation()
                  p.onNewMeeting(f.id)
                }}
              >
                <Plus size={13} />
              </button>
              <span className="anchor">
                <button
                  className="row-action"
                  title="Más opciones"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenu(menu === f.id ? null : f.id)
                  }}
                >
                  <MoreHorizontal size={13} />
                </button>
                <Popover open={menu === f.id} onClose={() => setMenu(null)} align="right">
                  <MenuItem icon={<FilePlus2 size={14} />} onClick={() => { setMenu(null); p.onNewMeeting(f.id) }}>
                    Nueva reunión
                  </MenuItem>
                  <MenuItem icon={<FolderPlus size={14} />} onClick={() => { setMenu(null); p.onNewFolder(f.id) }}>
                    Nueva subcarpeta
                  </MenuItem>
                  <MenuItem icon={<Pencil size={14} />} onClick={() => { setMenu(null); p.onRenameFolder(f) }}>
                    Renombrar
                  </MenuItem>
                  <div className="menu-sep" />
                  <MenuItem danger icon={<Trash2 size={14} />} onClick={() => { setMenu(null); p.onDeleteFolder(f) }}>
                    Eliminar carpeta
                  </MenuItem>
                </Popover>
              </span>
            </span>
          </div>
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                key="children"
                className="row-children"
                style={{ '--guide': `${12 + depth * INDENT}px` } as React.CSSProperties}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={soft}
              >
                <AnimatePresence initial={false}>
                  {renderFolders(f.id, depth + 1)}
                  {renderMeetings(f.id, depth + 1)}
                </AnimatePresence>
                {isEmpty && (
                  <div className="row-empty" style={{ paddingLeft: 30 + depth * INDENT }} onDragOver={(e) => overEmpty(e, f)}>
                    Vacía
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )
    })

  const empty = p.meetings.length === 0 && p.folders.length === 0

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <Logo size={22} />
          <span>Meeting Notes</span>
        </div>
        <button className="icon-btn" title="Ocultar panel" onClick={p.onCollapse}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="btn primary grow" onClick={() => p.onNewMeeting(null)}>
          <Plus size={15} strokeWidth={2.2} /> Nueva reunión
        </button>
        <button className="btn icon-only" title="Nueva carpeta" onClick={() => p.onNewFolder(null)}>
          <FolderPlus size={15} />
        </button>
      </div>

      <div className="sidebar-search">
        <Search size={14} className="search-icon" />
        <input placeholder="Buscar" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <AnimatePresence>
          {filter && (
            <motion.button
              className="icon-btn sm"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => setFilter('')}
              aria-label="Limpiar búsqueda"
            >
              <X size={12} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="sidebar-section-head">
        <span>Reuniones</span>
        <Select
          variant="ghost"
          align="right"
          value={sortMode}
          title="Ordenar reuniones"
          options={[
            { value: 'recent', label: 'Recientes' },
            { value: 'name', label: 'Nombre' },
            { value: 'manual', label: 'Manual' }
          ]}
          onChange={setSortMode}
        />
      </div>

      {results ? (
        <div className="tree search-results">
          {results.map((r) => (
            <button key={r.id} className={`search-hit ${r.id === p.selectedId ? 'selected' : ''}`} onClick={() => p.onSelect(r.id, q)}>
              <span className="row-title">{r.title}</span>
              <span className="row-sub">{fmtDate(r.createdAt)}</span>
              <span className="search-snippet">{renderSnippet(r.snippet)}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div className="tree-empty">
              <span>Sin resultados para “{q}”</span>
            </div>
          )}
        </div>
      ) : (
      <div
        ref={treeRef}
        className={['tree', dragging ? 'is-dragging' : ''].join(' ')}
        // Los huecos entre filas mantienen la última indicación.
        onDragOver={(e) => dragRef.current && e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            arm(null)
            show(null, null)
          }
        }}
        onDrop={drop}
      >
        <AnimatePresence initial={false}>
          {renderFolders(null, 0)}
          {renderMeetings(null, 0)}
        </AnimatePresence>
        {empty ? (
          <div className="tree-empty">
            <p>Todavía no hay reuniones</p>
            <span>Crea una y pulsa Grabar cuando empiece la llamada.</span>
          </div>
        ) : (
          <div className="tree-end" onDragOver={overEnd} />
        )}
        {hint?.kind === 'line' && (
          <div className="drop-line" style={{ left: 20 + hint.depth * INDENT, transform: `translateY(${hint.top}px)` }} />
        )}
      </div>
      )}

      <div className="sidebar-bottom">
        <AnimatePresence initial={false}>
          {p.updateReady && (
            <motion.button
              key="update"
              className="update-pill"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 32 }}
              exit={{ opacity: 0, height: 0 }}
              transition={soft}
              disabled={!!p.recordingId}
              title={p.recordingId ? 'Disponible al terminar la grabación' : 'Reinicia la app con la nueva versión'}
              onClick={p.onInstallUpdate}
            >
              <ArrowDownToLine size={15} /> <span>Actualizar a v{p.updateReady}</span>
            </motion.button>
          )}
        </AnimatePresence>
        <button className={`nav-item ${p.settingsOpen ? 'active' : ''}`} onClick={p.onOpenSettings}>
          <SettingsIcon size={15} /> <span>Configuración</span>
        </button>
      </div>
    </aside>
  )
}
