import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FolderOpen,
  GripVertical,
  ImageOff,
  ImagePlus,
  Maximize2,
  MoreHorizontal,
  Plus,
  Timer,
  Trash2
} from 'lucide-react'
import { IMAGE_TYPES, MAX_ATTACHMENT_BYTES, type NoteAttachment, type NoteSection } from '@shared/types'
import { fmtTime } from '../util'
import { Lightbox, type LightboxImage } from './Lightbox'
import { MenuItem, Popover, quick, soft, Spinner, useUi } from './ui'

interface Props {
  meetingId: string
  sections: NoteSection[]
  elapsedSec: number | null
  onChange: (sections: NoteSection[]) => void
}

const SECTION_MIME = 'application/x-section'
const TEMPLATES = ['Contexto', 'Decisiones', 'Acciones', 'Dudas', 'Ideas', 'Seguimiento']
const IMAGE_MIMES = new Set(Object.values(IMAGE_TYPES))

const attachmentUrl = (meetingId: string, a: NoteAttachment): string =>
  `meeting-audio://${meetingId}/attachments/${a.file}`

/** Archivos que se están arrastrando sobre una sección y si son imágenes válidas. */
type FileDrop = { id: string; ok: boolean }

export function NotesPanel({ meetingId, sections, elapsedSec, onChange }: Props): React.JSX.Element {
  const ui = useUi()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dropId, setDropId] = useState<string | null>(null)
  const [fileDrop, setFileDrop] = useState<FileDrop | null>(null)
  const [uploading, setUploading] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<number | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const sorted = [...sections].sort((a, b) => a.order - b.order)

  // Las imágenes se guardan de forma asíncrona: al terminar hay que partir de las secciones actuales.
  const latest = useRef(sections)
  latest.current = sections
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const update = (id: string, patch: Partial<NoteSection>): void =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const patchLatest = (id: string, fn: (s: NoteSection) => Partial<NoteSection>): void =>
    onChange(latest.current.map((s) => (s.id === id ? { ...s, ...fn(s) } : s)))

  const add = (title = 'Nueva sección'): void => {
    setAddMenu(false)
    onChange([...sections, { id: crypto.randomUUID(), title, content: '', order: sorted.length }])
  }

  const remove = async (s: NoteSection): Promise<void> => {
    setMenu(null)
    const images = s.attachments?.length ?? 0
    if (
      (s.content.trim() || images) &&
      !(await ui.confirm(
        'Eliminar sección',
        `Se borrará “${s.title}” y su contenido${images ? `, incluidas ${images === 1 ? 'la imagen' : `las ${images} imágenes`}` : ''}.`,
        { confirmLabel: 'Eliminar', danger: true }
      ))
    )
      return
    onChange(sorted.filter((x) => x.id !== s.id).map((x, i) => ({ ...x, order: i })))
    for (const a of s.attachments ?? []) void window.api.removeAttachment(meetingId, a.file)
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

  // ---------- imágenes ----------

  const attach = async (sectionId: string, files: File[], pasted = false): Promise<void> => {
    const valid = files.filter((f) => {
      if (!IMAGE_MIMES.has(f.type)) {
        ui.toast(`“${f.name || 'El archivo'}” no es una imagen compatible. Usa PNG, JPG, GIF o WebP.`)
        return false
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        ui.toast(`“${f.name}” supera los 25 MB.`)
        return false
      }
      return true
    })
    if (!valid.length) return
    setCollapsed((c) => (c.has(sectionId) ? new Set([...c].filter((x) => x !== sectionId)) : c))
    const bump = (d: number): void => setUploading((u) => ({ ...u, [sectionId]: (u[sectionId] ?? 0) + d }))
    bump(valid.length)

    const added: NoteAttachment[] = []
    for (const f of valid) {
      try {
        const bitmap = await createImageBitmap(f)
        const { width, height } = bitmap
        bitmap.close()
        const file = await window.api.addAttachment(meetingId, new Uint8Array(await f.arrayBuffer()))
        const name = pasted
          ? `Imagen pegada ${new Date().toLocaleTimeString('es-ES')}`
          : f.name.replace(/\.[^.]+$/, '') || 'Imagen'
        added.push({ id: crypto.randomUUID(), file, name, width, height })
      } catch (err) {
        ui.toast(`No se pudo añadir “${f.name || 'la imagen'}”: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
      } finally {
        bump(-1)
      }
    }
    if (!added.length) return
    // Se ha cambiado de reunión mientras se guardaban: no se asignan a otra.
    if (!alive.current) {
      for (const a of added) void window.api.removeAttachment(meetingId, a.file)
      return
    }
    patchLatest(sectionId, (s) => ({ attachments: [...(s.attachments ?? []), ...added] }))
  }

  const removeImage = async (sectionId: string, a: NoteAttachment): Promise<void> => {
    if (
      !(await ui.confirm('Eliminar imagen', `Se borrará “${a.name}” de las notas y del disco.`, {
        confirmLabel: 'Eliminar',
        danger: true
      }))
    )
      return
    patchLatest(sectionId, (s) => ({ attachments: (s.attachments ?? []).filter((x) => x.id !== a.id) }))
    await window.api.removeAttachment(meetingId, a.file)
  }

  // Todas las imágenes de la reunión, en el orden de las secciones, para el visor.
  const gallery: (LightboxImage & { sectionId: string })[] = sorted.flatMap((s) =>
    (s.attachments ?? []).map((a) => ({ ...a, url: attachmentUrl(meetingId, a), sectionId: s.id }))
  )

  const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

  return (
    <div className="notes">
      <div className="notes-scroll">
        <AnimatePresence initial={false}>
          {sorted.map((s, i) => {
            const open = !collapsed.has(s.id)
            const images = s.attachments ?? []
            const pending = uploading[s.id] ?? 0
            const lines = s.content.trim() ? s.content.trim().split('\n').length : 0
            return (
              <motion.div
                key={s.id}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
                transition={soft}
                className={['note', dropId === s.id ? 'drop' : '', fileDrop?.id === s.id ? 'file-drop' : ''].join(' ')}
                onPaste={(e) => {
                  // Solo si no hay texto: al copiar de Word o del navegador también viene una imagen.
                  const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
                  if (!files.length || e.clipboardData.getData('text/plain')) return
                  e.preventDefault()
                  void attach(s.id, files, true)
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(SECTION_MIME)) {
                    e.preventDefault()
                    setDropId(s.id)
                  } else if (hasFiles(e)) {
                    e.preventDefault()
                    const items = [...e.dataTransfer.items].filter((it) => it.kind === 'file')
                    const ok = items.some((it) => IMAGE_MIMES.has(it.type))
                    e.dataTransfer.dropEffect = ok ? 'copy' : 'none'
                    if (fileDrop?.id !== s.id || fileDrop.ok !== ok) setFileDrop({ id: s.id, ok })
                  }
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                  setDropId(null)
                  setFileDrop(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDropId(null)
                  setFileDrop(null)
                  if (hasFiles(e)) void attach(s.id, [...e.dataTransfer.files])
                  else move(e.dataTransfer.getData(SECTION_MIME), s.id)
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
                  {!open && (lines > 0 || images.length > 0) && (
                    <span className="note-count">
                      {[
                        lines && `${lines} ${lines === 1 ? 'línea' : 'líneas'}`,
                        images.length && `${images.length} ${images.length === 1 ? 'imagen' : 'imágenes'}`
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
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
                      {(images.length > 0 || pending > 0) && (
                        <div className="note-images">
                          <AnimatePresence initial={false}>
                            {images.map((a) => (
                              <Thumb
                                key={a.id}
                                url={attachmentUrl(meetingId, a)}
                                attachment={a}
                                onOpen={() => setPreview(gallery.findIndex((g) => g.id === a.id))}
                                onShow={() => void window.api.showAttachment(meetingId, a.file)}
                                onRemove={() => void removeImage(s.id, a)}
                              />
                            ))}
                            {Array.from({ length: pending }, (_, k) => (
                              <motion.div
                                key={`pending-${k}`}
                                className="thumb pending"
                                initial={{ opacity: 0, scale: 0.96 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                                transition={quick}
                              >
                                <Spinner />
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {fileDrop?.id === s.id && (
                    <motion.div
                      className={`note-drop ${fileDrop.ok ? '' : 'invalid'}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={quick}
                    >
                      {fileDrop.ok ? <ImagePlus size={16} /> : <ImageOff size={16} />}
                      <span>{fileDrop.ok ? 'Suelta aquí para añadir la imagen' : 'Solo imágenes PNG, JPG, GIF o WebP'}</span>
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

      <Lightbox images={gallery} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
    </div>
  )
}

function Thumb({
  url,
  attachment,
  onOpen,
  onShow,
  onRemove
}: {
  url: string
  attachment: NoteAttachment
  onOpen: () => void
  onShow: () => void
  onRemove: () => void
}): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const stop =
    (fn: () => void) =>
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      fn()
    }
  return (
    <motion.div
      layout
      className="thumb"
      role="button"
      tabIndex={0}
      title={attachment.name}
      aria-label={`Ver ${attachment.name}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
      transition={soft}
      onClick={broken ? undefined : onOpen}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && !broken) {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {broken ? (
        <span className="thumb-broken">
          <ImageOff size={16} />
        </span>
      ) : (
        <img src={url} alt={attachment.name} draggable={false} loading="lazy" onError={() => setBroken(true)} />
      )}
      <span className="thumb-actions">
        {!broken && (
          <button className="thumb-btn" title="Ver" aria-label="Ver" onClick={stop(onOpen)}>
            <Maximize2 size={13} />
          </button>
        )}
        <button className="thumb-btn" title="Mostrar en la carpeta" aria-label="Mostrar en la carpeta" onClick={stop(onShow)}>
          <FolderOpen size={13} />
        </button>
        <button className="thumb-btn danger" title="Eliminar" aria-label="Eliminar" onClick={stop(onRemove)}>
          <Trash2 size={13} />
        </button>
      </span>
    </motion.div>
  )
}
