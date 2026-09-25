import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import {
  ME,
  speakerLabel,
  type Meeting,
  type Settings,
  type SpeakerSuggestion
} from '../shared/types'
import { contextFor, estimateTokens, fitTranscript, ollamaJson, ollamaStream, transcriptBudget } from './ollama'

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Transcripción agrupada por turnos de palabra. */
export function transcriptText(m: Meeting, myName: string): string {
  const lines: string[] = []
  let lastSpeaker = ''
  for (const s of m.transcript) {
    const who = speakerLabel(m.speakers[s.speakerId], myName)
    if (who === lastSpeaker) lines[lines.length - 1] += ' ' + s.text
    else lines.push(`[${fmtTime(s.start)}] ${who}: ${s.text}`)
    lastSpeaker = who
  }
  return lines.join('\n')
}

/** maxTranscriptChars: recorta la transcripción para modelos con poco contexto (Ollama). */
export function buildMeetingDocument(m: Meeting, myName: string, maxTranscriptChars = Infinity): string {
  const notes = [...m.sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.content.trim())
    .map((s) => `### ${s.title}\n${s.content.trim()}`)
    .join('\n\n')
  const me = m.speakers[ME] ? `\nEl usuario de la app es "${speakerLabel(m.speakers[ME], myName)}".` : ''

  return [
    `<reunion titulo="${m.title}" fecha="${m.createdAt}">${me}`,
    `<notas_del_usuario>\n${notes || '(sin notas)'}\n</notas_del_usuario>`,
    `<transcripcion>\n${fitTranscript(transcriptText(m, myName), maxTranscriptChars) || '(sin transcripción)'}\n</transcripcion>`,
    `</reunion>`
  ].join('\n\n')
}

function anthropic(s: Settings): Anthropic {
  if (!s.keys.anthropic) throw new Error('Falta la API key de Anthropic (Configuración > API keys).')
  return new Anthropic({ apiKey: s.keys.anthropic })
}

function openai(s: Settings): OpenAI {
  if (!s.keys.openai) throw new Error('Falta la API key de OpenAI (Configuración > API keys).')
  return new OpenAI({ apiKey: s.keys.openai })
}

export async function summarize(
  m: Meeting,
  s: Settings,
  promptId: string,
  onDelta: (text: string) => void
): Promise<string> {
  const prompt =
    s.prompts.find((p) => p.id === promptId) ??
    s.prompts.find((p) => p.id === s.defaultPromptId) ??
    s.prompts[0]
  if (s.llmProvider === 'ollama') {
    // Se reserva sitio para un acta larga; el resto del contexto es para la reunión.
    const output = 4096
    const other = buildMeetingDocument(m, s.myName).length - transcriptText(m, s.myName).length + prompt.content.length
    const doc = buildMeetingDocument(m, s.myName, transcriptBudget(other, output))
    return ollamaStream(
      {
        url: s.ollamaUrl,
        model: s.ollamaModel,
        system: prompt.content,
        user: doc,
        numCtx: contextFor(estimateTokens(doc + prompt.content), output),
        temperature: 0.3
      },
      onDelta
    )
  }

  const doc = buildMeetingDocument(m, s.myName)

  if (s.llmProvider === 'openai') {
    const stream = await openai(s).responses.create({
      model: s.openaiModel || 'gpt-5',
      instructions: prompt.content,
      input: doc,
      stream: true
    })
    let full = ''
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        full += event.delta
        onDelta(event.delta)
      } else if (event.type === 'error') {
        throw new Error(event.message)
      }
    }
    return full
  }

  const stream = anthropic(s).beta.messages.stream({
    model: s.anthropicModel || 'claude-opus-5',
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    // Si el modelo rechaza la petición, la API la reintenta con otro modelo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: prompt.content,
    messages: [{ role: 'user', content: doc }]
  })
  stream.on('text', onDelta)
  const message = await stream.finalMessage()
  if (message.stop_reason === 'refusal') throw new Error('El modelo rechazó generar el resumen.')
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

const SuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      label: z.string().describe('Etiqueta genérica tal y como aparece, p. ej. "Persona 2"'),
      name: z.string().describe('Nombre propuesto'),
      reason: z.string().describe('Evidencia breve en la transcripción')
    })
  )
})

/** Propone nombres reales para "Persona N" a partir del contexto de la conversación. */
export async function suggestSpeakerNames(m: Meeting, s: Settings): Promise<SpeakerSuggestion[]> {
  const unnamed = Object.values(m.speakers).filter((sp) => !sp.name && sp.id !== ME)
  if (unnamed.length === 0) return []
  const labels = unnamed.map((sp) => speakerLabel(sp)).join(', ')
  const header = `Etiquetas a identificar: ${labels}\n${
    s.knownPeople.length ? `Personas conocidas del usuario (pueden aparecer o no): ${s.knownPeople.join(', ')}\n` : ''
  }`
  const build = (maxChars = Infinity): string =>
    `${header}\n<transcripcion>\n${fitTranscript(transcriptText(m, s.myName), maxChars)}\n</transcripcion>`
  const input = build()

  let result: z.infer<typeof SuggestionsSchema> | null
  if (s.llmProvider === 'ollama') {
    const output = 2048
    const doc = build(transcriptBudget(header.length + s.speakerIdPrompt.length + 100, output))
    const raw = await ollamaJson({
      url: s.ollamaUrl,
      model: s.ollamaModel,
      system: s.speakerIdPrompt,
      user: doc,
      numCtx: contextFor(estimateTokens(doc + s.speakerIdPrompt), output),
      format: z.toJSONSchema(SuggestionsSchema),
      temperature: 0
    })
    const parsed = SuggestionsSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`El modelo "${s.ollamaModel}" ha respondido con otro formato. Prueba otra vez o con un modelo mayor.`)
    }
    result = parsed.data
  } else if (s.llmProvider === 'openai') {
    const res = await openai(s).responses.parse({
      model: s.openaiModel || 'gpt-5',
      instructions: s.speakerIdPrompt,
      input,
      text: { format: zodTextFormat(SuggestionsSchema, 'speaker_suggestions') }
    })
    result = res.output_parsed
  } else {
    const res = await anthropic(s).messages.parse({
      model: s.anthropicModel || 'claude-opus-5',
      max_tokens: 16000,
      system: s.speakerIdPrompt,
      messages: [{ role: 'user', content: input }],
      output_config: { format: zodOutputFormat(SuggestionsSchema) }
    })
    if (res.stop_reason === 'refusal') throw new Error('El modelo rechazó la petición.')
    result = res.parsed_output
  }

  const byLabel = new Map(unnamed.map((sp) => [speakerLabel(sp).toLowerCase(), sp.id]))
  return (result?.suggestions ?? [])
    .map((x) => ({
      speakerId: byLabel.get(x.label.trim().toLowerCase()) ?? '',
      name: x.name.trim(),
      reason: x.reason
    }))
    .filter((x) => x.speakerId && x.name)
}
