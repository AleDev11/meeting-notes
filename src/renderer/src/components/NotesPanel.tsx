import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowUp, ChevronRight, GripVertical, MoreHorizontal, Plus, Timer, Trash2 } from 'lucide-react'
import type { NoteSection } from '@shared/types'
import { fmtTime } from '../util'
import { MenuItem, Popover, quick, soft, useUi } from './ui'

interface Props {
  sections: NoteSection[]
  elapsedSec: number | null
  onChange: (sections: NoteSection[]) => void
}

const SECTION_MIME = 'application/x-section'
const TEMPLATES = ['Contexto', 'Decisiones', 'Acciones', 'Dudas', 'Ideas', 'Seguimiento']

export function NotesPanel({ sections, elapsedSec, onChange }: Props): React.JSX.Element {
  const ui = useUi()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dropId, setDropId] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const sorted = [...sections].sort((a, b) => a.order - b.order)

  const update = (id: string, patch: Partial<NoteSection>): void =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const add = (title = 'Nueva sección'): void => {
    setAddMenu(false)
    onChange([...sections, { id: crypto.randomUUID(), title, content: '', order: sorted.length }])
  }

  const remove = async (s: NoteSection): Promise<void> => {
    setMenu(null)
    if (
      s.content.trim() &&
      !(await ui.confirm('Eliminar sección', `Se borrará “${s.title}” y su contenido.`, {
        confirmLabel: 'Eliminar',
        danger: true
      }))
    )
      return
    onChange(sorted.filter((x) => x.id !== s.id).map((x, i) => ({ ...x, order: i })))
  }

  const move = (dragId: string, beforeId: string | null): void => {
    const dragged = sorted.find((s) => s.id === dragId)
    if (!dragged || dragId === beforeId) return
    const rest = sorted.filter((s) => s.id !== dragId)
    const idx = beforeId ? rest.findIndex((s) => s.id === beforeId) : rest.length
    rest.splice(idx < 0 ? rest.length : idx, 0, dragged)
    onChange(rest.map((s, i) => ({ ...s, order: i })))
  }

  const shift = (s: NoteSection, delta: number): void => {
    setMenu(null)
    const i = sorted.findIndex((x) => x.id === s.id)
    const j = i + delta
    if (j < 0 || j >= sorted.length) return
    const copy = [...sorted]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    onChange(copy.map((x, k) => ({ ...x, order: k })))
  }

  const toggle = (id: string): void =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const stamp = (s: NoteSection): void => {
    if (elapsedSec === null) return
    const sep = s.content && !s.content.endsWith('\n') ? '\n' : ''
    update(s.id, { content: `${s.content}${sep}[${fmtTime(elapsedSec)}] ` })
  }

  return (
    <div className="notes">
      <div className="notes-scroll">
        <AnimatePresence initial={false}>
          {sorted.map((s, i) => {
            const open = !collapsed.has(s.id)
            return (
              <motion.div
                key={s.id}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
                transition={soft}
                className={['note', dropId === s.id ? 'drop' : ''].join(' ')}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(SECTION_MIME)) {
                    e.preventDefault()
                    setDropId(s.id)
                  }
                }}
                onDragLeave={() => setDropId(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDropId(null)
                  move(e.dataTransfer.getData(SECTION_MIME), s.id)
                }}
              >
                <div className="note-head">
                  <span
                    className="drag-handle"
                    draggable
                    title="Arrastra para reordenar"
                    onDragStart={(e) => e.dataTransfer.setData(SECTION_MIME, s.id)}
                  >
                    <GripVertical size={14} />
                  </span>
                  <button className="icon-btn sm" onClick={() => toggle(s.id)} aria-label={open ? 'Plegar' : 'Desplegar'}>
                    <motion.span style={{ display: 'flex' }} animate={{ rotate: open ? 90 : 0 }} transition={quick}>
                      <ChevronRight size={14} />
                    </motion.span>
                  </button>
                  <input
                    className="note-title"
                    value={s.title}
                    onChange={(e) => update(s.id, { title: e.target.value })}
                  />
                  {!open && s.content.trim() && <span className="note-count">{s.content.trim().split('\n').length} líneas</span>}
                  {elapsedSec !== null && (
                    <button className="icon-btn sm" title="Insertar marca de tiempo (Ctrl+T)" onClick={() => stamp(s)}>
                      <Timer size={14} />
                    </button>
                  )}
                  <span className="anchor">
                    <button className="icon-btn sm" onClick={() => setMenu(menu === s.id ? null : s.id)} aria-label="Opciones">
                      <MoreHorizontal size={14} />
                    </button>
                    <Popover open={menu === s.id} onClose={() => setMenu(null)} align="right">
                      <MenuItem icon={<ArrowUp size={14} />} disabled={i === 0} onClick={() => shift(s, -1)}>
                        Subir
                      </MenuItem>
                      <MenuItem icon={<ArrowDown size={14} />} disabled={i === sorted.length - 1} onClick={() => shift(s, 1)}>
                        Bajar
                      </MenuItem>
                      <div className="menu-sep" />
                      <MenuItem danger icon={<Trash2 size={14} />} onClick={() => void remove(s)}>
                        Eliminar sección
                      </MenuItem>
                    </Popover>
                  </span>
                </div>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key="body"
                      className="note-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={soft}
                    >
                      <textarea
                        value={s.content}
                        placeholder="Escribe aquí…"
                        onChange={(e) => update(s.id, { content: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 't' && (e.ctrlKey || e.metaKey) && elapsedSec !== null) {
                            e.preventDefault()
                            stamp(s)
                          }
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>

        <motion.div layout="position" transition={soft} className="anchor add-section">
          <button className="add-row" onClick={() => setAddMenu(!addMenu)}>
            <Plus size={14} /> Añadir sección
          </button>
          <Popover open={addMenu} onClose={() => setAddMenu(false)}>
            <MenuItem icon={<Plus size={14} />} onClick={() => add()}>
              Sección en blanco
            </MenuItem>
            <div className="menu-heading">Plantillas</div>
            {TEMPLATES.map((t) => (
              <MenuItem key={t} onClick={() => add(t)}>
                {t}
              </MenuItem>
            ))}
          </Popover>
        </motion.div>
      </div>
    </div>
  )
}
