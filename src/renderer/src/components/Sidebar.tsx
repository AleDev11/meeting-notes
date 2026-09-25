import { useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownToLine,
  ChevronRight,
  FilePlus2,
  Folder as FolderIcon,
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
import type { Folder, MeetingSummary } from '@shared/types'
import { fmtDate, fmtDuration } from '../util'
import { Logo, MenuItem, Popover, quick, soft } from './ui'

export type SortMode = 'manual' | 'recent' | 'name'

interface Props {
  folders: Folder[]
  meetings: MeetingSummary[]
  selectedId: string | null
  recordingId: string | null
  settingsOpen: boolean
  onSelect: (id: string) => void
  onNewMeeting: (folderId: string | null) => void
  onNewFolder: (parentId: string | null) => void
  onRenameFolder: (f: Folder) => void
  onDeleteFolder: (f: Folder) => void
  onDeleteMeeting: (m: MeetingSummary) => void
  onMoveMeeting: (id: string, folderId: string | null, beforeId: string | null) => void
  onMoveFolder: (id: string, parentId: string | null, beforeId: string | null) => void
  onOpenSettings: () => void
  onCollapse: () => void
  /** Versión descargada y lista para instalar. */
  updateReady: string | null
  onInstallUpdate: () => void
}

const MEETING_MIME = 'application/x-meeting'
const FOLDER_MIME = 'application/x-folder'
const INDENT = 14

export function Sidebar(p: Props): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [menu, setMenu] = useState<string | null>(null)

  const sortMeetings = (list: MeetingSummary[]): MeetingSummary[] => {
    const copy = [...list]
    if (sortMode === 'recent') copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else if (sortMode === 'name') copy.sort((a, b) => a.title.localeCompare(b.title))
    else copy.sort((a, b) => a.order - b.order)
    return copy
  }

  const q = filter.trim().toLowerCase()
  const visibleMeetings = q ? p.meetings.filter((m) => m.title.toLowerCase().includes(q)) : p.meetings

  const toggle = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const allow = (e: DragEvent, key: string): void => {
    const t = e.dataTransfer.types
    if (t.includes(MEETING_MIME) || t.includes(FOLDER_MIME)) {
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(key)
    }
  }

  const dropOnFolder = (e: DragEvent, folder: Folder | null): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const meetingId = e.dataTransfer.getData(MEETING_MIME)
    const folderId = e.dataTransfer.getData(FOLDER_MIME)
    if (meetingId) p.onMoveMeeting(meetingId, folder?.id ?? null, null)
    if (folderId && folderId !== folder?.id) {
      // Franja superior de la fila: colocar delante (mismo nivel). Resto: dentro.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const before = folder && e.clientY - rect.top < rect.height * 0.3
      if (before) p.onMoveFolder(folderId, folder.parentId, folder.id)
      else p.onMoveFolder(folderId, folder?.id ?? null, null)
    }
  }

  const dropOnMeeting = (e: DragEvent, target: MeetingSummary): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const meetingId = e.dataTransfer.getData(MEETING_MIME)
    if (meetingId && meetingId !== target.id) {
      if (sortMode !== 'manual') setSortMode('manual')
      p.onMoveMeeting(meetingId, target.folderId, target.id)
    }
  }

  const countIn = (folderId: string): number => p.meetings.filter((m) => m.folderId === folderId).length

  const renderMeetings = (folderId: string | null, depth: number): React.JSX.Element[] =>
    sortMeetings(visibleMeetings.filter((m) => m.folderId === folderId)).map((m) => {
      const recording = m.id === p.recordingId
      const selected = m.id === p.selectedId && !p.settingsOpen
      return (
        <motion.div
          key={m.id}
          layout="position"
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6, transition: { duration: 0.12 } }}
          transition={soft}
        >
          <div
            className={['row row-meeting', selected ? 'selected' : '', dropTarget === m.id ? 'drop' : ''].join(' ')}
            style={{ paddingLeft: 8 + depth * INDENT }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(MEETING_MIME, m.id)}
            onDragOver={(e) => allow(e, m.id)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => dropOnMeeting(e, m)}
            onClick={() => p.onSelect(m.id)}
          >
            {selected && <motion.span layoutId="row-selected" className="row-selected-bg" transition={soft} />}
            <span className="row-lead">
              {recording ? (
                <span className="rec-dot" />
              ) : m.status === 'processing' ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <span className="row-bullet" />
              )}
            </span>
            <span className="row-body">
              <span className="row-title">{m.title}</span>
              <span className="row-sub">
                {recording ? 'Grabando ahora' : fmtDate(m.createdAt)}
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
    p.folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((f) => {
        const isOpen = !collapsed.has(f.id) || !!q
        return (
          <motion.div key={f.id} layout="position" transition={soft}>
            <div
              className={['row row-folder', dropTarget === f.id ? 'drop' : '', menu === f.id ? 'menu-open' : ''].join(' ')}
              style={{ paddingLeft: 4 + depth * INDENT }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(FOLDER_MIME, f.id)}
              onDragOver={(e) => allow(e, f.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => dropOnFolder(e, f)}
              onClick={() => toggle(f.id)}
              onDoubleClick={() => p.onRenameFolder(f)}
            >
              <motion.span className="row-chev" animate={{ rotate: isOpen ? 90 : 0 }} transition={quick}>
                <ChevronRight size={13} />
              </motion.span>
              <FolderIcon size={14} className="row-folder-icon" />
              <span className="row-title">{f.name}</span>
              <span className="row-count">{countIn(f.id) || ''}</span>
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
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={soft}
                >
                  <AnimatePresence initial={false}>
                    {renderFolders(f.id, depth + 1)}
                    {renderMeetings(f.id, depth + 1)}
                  </AnimatePresence>
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
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} title="Ordenar reuniones">
          <option value="recent">Recientes</option>
          <option value="name">Nombre</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <div
        className={['tree', dropTarget === 'root' ? 'drop' : ''].join(' ')}
        onDragOver={(e) => allow(e, 'root')}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => dropOnFolder(e, null)}
      >
        <AnimatePresence initial={false}>
          {renderFolders(null, 0)}
          {renderMeetings(null, 0)}
        </AnimatePresence>
        {empty && (
          <div className="tree-empty">
            <p>Todavía no hay reuniones</p>
            <span>Crea una y pulsa Grabar cuando empiece la llamada.</span>
          </div>
        )}
        {q && visibleMeetings.length === 0 && !empty && <div className="tree-empty"><span>Sin resultados para “{filter}”</span></div>}
      </div>

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
