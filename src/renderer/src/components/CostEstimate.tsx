import { useState } from 'react'
import { motion } from 'motion/react'
import { Info, TrendingDown } from 'lucide-react'
import { estimateCost, PRICES_UPDATED } from '@shared/pricing'
import type { Settings } from '@shared/types'
import { soft } from './ui'

const usd = (n: number): string =>
  n.toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface Tip {
  text: string
  saving: number
  patch: Partial<Settings>
  action: string
}

function tipsFor(s: Settings, current: number): Tip[] {
  const tips: Tip[] = []
  const saving = (patch: Partial<Settings>): number => current - estimateCost({ ...s, ...patch }).perHour
  if (s.liveProvider !== 'none' && s.separateMic) {
    const patch = { separateMic: false }
    tips.push({
      text: 'Transcribir tu micro y la llamada juntos en un solo audio. Dejarías de salir siempre como “Yo” automáticamente.',
      saving: saving(patch),
      patch,
      action: 'Usar un solo audio'
    })
  }
  if (s.llmProvider === 'anthropic' && /opus|fable/.test(s.anthropicModel)) {
    const patch = { anthropicModel: 'claude-sonnet-5' }
    tips.push({ text: 'Resumir con Claude Sonnet 5 en lugar de un modelo de gama alta.', saving: saving(patch), patch, action: 'Usar Sonnet 5' })
  }
  if (s.liveProvider !== 'none') {
    const patch = { liveProvider: 'none' as const }
    tips.push({
      text: 'Prescindir de la transcripción en vivo: verías el texto y a las personas solo al terminar.',
      saving: saving(patch),
      patch,
      action: 'Desactivar en vivo'
    })
  }
  return tips.filter((t) => t.saving > 0.005).sort((a, b) => b.saving - a.saving).slice(0, 2)
}

export function CostEstimate({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }): React.JSX.Element {
  const [hours, setHours] = useState(() => Number(localStorage.getItem('cost-hours')) || 20)
  const est = estimateCost(s)
  const max = Math.max(...est.lines.map((l) => l.perHour ?? 0), 0.01)
  const tips = tipsFor(s, est.perHour)

  const changeHours = (v: number): void => {
    const h = Math.max(1, Math.min(500, Math.round(v) || 1))
    setHours(h)
    localStorage.setItem('cost-hours', String(h))
  }

  return (
    <section className="card cost">
      <div className="cost-head">
        <div>
          <h2>Coste estimado</h2>
          <p className="muted small">Con la configuración actual, capturando micrófono y audio del sistema.</p>
        </div>
        <div className="cost-totals">
          <div className="cost-total">
            <motion.span key={est.perHour.toFixed(2)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
              {usd(est.perHour)}
            </motion.span>
            <small>por hora de reunión</small>
          </div>
          <div className="cost-total secondary">
            <motion.span key={(est.perHour * hours).toFixed(2)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
              {usd(est.perHour * hours)}
            </motion.span>
            <small>
              al mes con{' '}
              <input
                type="number"
                min={1}
                max={500}
                value={hours}
                onChange={(e) => changeHours(Number(e.target.value))}
                aria-label="Horas de reunión al mes"
              />{' '}
              h
            </small>
          </div>
        </div>
      </div>

      <div className="cost-lines">
        {est.lines.map((l) => (
          <div key={l.key} className="cost-line">
            <div className="cost-line-top">
              <span className="cost-label">{l.label}</span>
              <span className="cost-value">{l.perHour === null ? '—' : l.perHour === 0 ? 'Gratis' : `${usd(l.perHour)}/h`}</span>
            </div>
            <div className="cost-bar">
              <motion.span
                className={`cost-fill ${l.key}`}
                initial={false}
                animate={{ width: `${l.perHour ? Math.max(2, (l.perHour / max) * 100) : 0}%` }}
                transition={soft}
              />
            </div>
            <span className="cost-detail">{l.detail}</span>
          </div>
        ))}
      </div>

      {est.unknownModel && (
        <p className="warn small">
          No tengo el precio del modelo “{est.unknownModel}”, así que el resumen no está incluido en el total.
        </p>
      )}

      {tips.length > 0 && (
        <div className="cost-tips">
          {tips.map((t) => (
            <div key={t.action} className="cost-tip">
              <TrendingDown size={15} />
              <span className="cost-tip-text">
                <strong>Ahorra {usd(t.saving)}/h</strong> · {t.text}
              </span>
              <button className="btn sm" onClick={() => set(t.patch)}>
                {t.action}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="cost-note">
        <Info size={12} /> Precios públicos de {PRICES_UPDATED}, en USD. El resumen asume ~17.000 tokens de entrada y ~4.000 de
        salida por hora; “Deducir nombres” añade algo menos que un resumen cada vez que se usa. Los créditos gratuitos (Deepgram 200 $,
        AssemblyAI 50 $) no se descuentan.
      </p>
    </section>
  )
}
