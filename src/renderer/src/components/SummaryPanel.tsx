import { useState } from 'react'
import Markdown from 'react-markdown'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Download, Eye, Pencil, RefreshCw, ScrollText } from 'lucide-react'
import type { Meeting, PromptTemplate } from '@shared/types'
import { soft, Spinner, useUi } from './ui'

interface Props {
  meeting: Meeting
  prompts: PromptTemplate[]
  defaultPromptId: string
  providerName: string
  streaming: string | null
  recording: boolean
  onGenerate: (promptId: string) => void
  onEdit: (summary: string) => void
  onExport: () => void
}

export function SummaryPanel(p: Props): React.JSX.Element {
  const ui = useUi()
  const m = p.meeting
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [promptId, setPromptId] = useState(m.summaryPromptId ?? p.defaultPromptId)
  const busy = p.streaming !== null
  const text = p.streaming ?? m.summary ?? ''
  const hasContent = m.transcript.length > 0 || m.sections.some((s) => s.content.trim())

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(m.summary ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="summary">
      <div className="summary-bar">
        <select value={promptId} onChange={(e) => setPromptId(e.target.value)} disabled={busy} title="Tipo de resumen">
          {p.prompts.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={busy || p.recording || !hasContent}
          onClick={() => {
            setEditing(false)
            p.onGenerate(promptId)
          }}
          title={p.recording ? 'Detén la grabación para generar el resumen' : `Generar con ${p.providerName}`}
        >
          {busy ? <Spinner size={13} /> : m.summary ? <RefreshCw size={14} /> : <ScrollText size={14} />}
          {busy ? 'Redactando…' : m.summary ? 'Regenerar' : 'Generar resumen'}
        </button>
        <span className="grow" />
        <AnimatePresence>
          {m.summary && !busy && (
            <motion.div className="bar-tools" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button className="icon-btn" title={editing ? 'Ver' : 'Editar'} onClick={() => setEditing(!editing)}>
                {editing ? <Eye size={15} /> : <Pencil size={15} />}
              </button>
              <button className="icon-btn" title="Copiar" onClick={() => void copy().catch(() => ui.toast('No se pudo copiar'))}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              <button className="icon-btn" title="Exportar a Markdown" onClick={p.onExport}>
                <Download size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="summary-scroll">
        {m.status === 'processing' && !busy && (
          <div className="banner">
            <Spinner size={13} /> <span>Espera a que termine la identificación de personas para un resumen más preciso.</span>
          </div>
        )}
        {editing && !busy ? (
          <textarea className="summary-editor" value={m.summary ?? ''} onChange={(e) => p.onEdit(e.target.value)} />
        ) : text ? (
          <motion.div className={`markdown ${busy ? 'streaming' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={soft}>
            <Markdown>{text}</Markdown>
          </motion.div>
        ) : busy ? (
          <div className="skeleton">
            {[70, 92, 84, 40, 88, 76].map((w, i) => (
              <span key={i} style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        ) : (
          <motion.div className="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
            <div className="empty-icon">
              <ScrollText size={22} />
            </div>
            <h4>Acta de la reunión</h4>
            <p>
              Al terminar, genera un resumen con decisiones, acciones y puntos clave usando la transcripción, las personas
              identificadas y tus notas. Las plantillas se editan en Configuración.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
