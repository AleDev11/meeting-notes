import type { Settings } from './types'

/**
 * Precios de referencia en USD (tarifas públicas pay-as-you-go, septiembre 2026).
 * Pueden cambiar: la estimación es orientativa.
 */
export const PRICES_UPDATED = 'septiembre 2026'

const DEEPGRAM = {
  streamingMono: 0.0048, // $/min
  streamingMulti: 0.0058,
  streamingDiarize: 0.002, // $/min extra en streaming
  batchMono: 0.0043, // diarización incluida
  batchMulti: 0.0052
}
const ELEVENLABS = { realtimePerHour: 0.39, batchPerHour: 0.22 }
const ASSEMBLYAI = { batchPerHour: 0.21, diarizePerHour: 0.02 }

/** $ por millón de tokens [entrada, salida]. */
const LLM: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'gpt-5': [1.25, 10],
  'gpt-5-mini': [0.25, 2],
  'gpt-5.4': [2.5, 15],
  'gpt-5.5': [5, 30],
  'gpt-5.6-sol': [5, 30],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.6-luna': [0.2, 1.2]
}

/** Tokens aproximados de una hora de reunión en español + notas + prompt. */
const TOKENS_PER_HOUR = { input: 17_000, output: 4_000 }

export interface CostLine {
  key: 'live' | 'final' | 'summary'
  label: string
  detail: string
  /** null = modelo sin precio conocido */
  perHour: number | null
}

export interface CostEstimate {
  lines: CostLine[]
  perHour: number
  unknownModel: string | null
}

const multilingual = (s: Settings): boolean => !s.language || s.language === 'multi'

function liveCost(s: Settings): Omit<CostLine, 'key' | 'label'> {
  // Con el micro aparte hay dos transcripciones en vivo: micro (sin separar voces) y sistema (separando).
  const streams = s.separateMic ? [{ diarize: false }, { diarize: true }] : [{ diarize: true }]
  const n = streams.length === 2 ? '2 transcripciones simultáneas (tu micro y la llamada)' : '1 transcripción (audio mezclado)'
  switch (s.liveProvider) {
    case 'deepgram': {
      const base = multilingual(s) ? DEEPGRAM.streamingMulti : DEEPGRAM.streamingMono
      const perMin = streams.reduce((t, st) => t + base + (st.diarize ? DEEPGRAM.streamingDiarize : 0), 0)
      return { perHour: perMin * 60, detail: `Deepgram · ${n}` }
    }
    case 'elevenlabs':
      return { perHour: ELEVENLABS.realtimePerHour * streams.length, detail: `ElevenLabs Realtime · ${n}` }
    default:
      return { perHour: 0, detail: 'Desactivada' }
  }
}

function finalCost(s: Settings): Omit<CostLine, 'key' | 'label'> {
  // Con el micro aparte se procesan dos pistas: la tuya (sin separar voces) y la de la llamada.
  const tracks = s.separateMic ? 2 : 1
  const n = tracks === 2 ? ' · 2 pistas (tu micro y la llamada)' : ''
  switch (s.finalProvider) {
    case 'elevenlabs':
      return { perHour: ELEVENLABS.batchPerHour * tracks, detail: `ElevenLabs Scribe v2${n}` }
    case 'assemblyai':
      return {
        perHour: ASSEMBLYAI.batchPerHour * tracks + ASSEMBLYAI.diarizePerHour,
        detail: `AssemblyAI${n}`
      }
    case 'deepgram':
      return {
        perHour: (multilingual(s) ? DEEPGRAM.batchMulti : DEEPGRAM.batchMono) * 60 * tracks,
        detail: `Deepgram Nova-3${n}`
      }
    default:
      return { perHour: 0, detail: 'Desactivada' }
  }
}

export function knownModels(prefix: 'claude' | 'gpt'): string[] {
  return Object.keys(LLM).filter((m) => m.startsWith(prefix))
}

export function llmPrice(model: string): [number, number] | null {
  return LLM[model.trim()] ?? null
}

export function estimateCost(s: Settings): CostEstimate {
  const local = s.llmProvider === 'ollama'
  const model = local ? s.ollamaModel : s.llmProvider === 'openai' ? s.openaiModel : s.anthropicModel
  // Con Ollama el modelo corre en el equipo: no hay coste por token.
  const price: [number, number] | null = local ? [0, 0] : llmPrice(model)
  const summary = price
    ? (TOKENS_PER_HOUR.input * price[0] + TOKENS_PER_HOUR.output * price[1]) / 1_000_000
    : null
  const detail = local ? `${model || 'Ollama'} · en tu equipo, sin coste` : `${model} · un resumen por reunión`
  const lines: CostLine[] = [
    { key: 'live', label: 'Transcripción en vivo', ...liveCost(s) },
    { key: 'final', label: 'Transcripción final', ...finalCost(s) },
    { key: 'summary', label: 'Resumen con IA', detail, perHour: summary }
  ]
  return {
    lines,
    perHour: lines.reduce((t, l) => t + (l.perHour ?? 0), 0),
    unknownModel: price ? null : model
  }
}
