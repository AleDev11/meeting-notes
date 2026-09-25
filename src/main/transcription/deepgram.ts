import { readFile } from 'fs/promises'
import WebSocket from 'ws'
import { request } from './http'
import {
  isMultilingual,
  langCode,
  PAUSE_SPLIT,
  SAMPLE_RATE,
  type BatchOptions,
  type LiveCallbacks,
  type LiveOptions,
  type LiveSession,
  type RawSegment
} from './types'

interface DgWord {
  word: string
  punctuated_word?: string
  start: number
  end: number
  speaker?: number
  language?: string
}

/**
 * Parámetros comunes. En modo multilingüe Deepgram cambia de idioma sobre la marcha
 * (español, inglés, francés, alemán, portugués, italiano…). El catalán solo lo
 * reconoce nova-2 y en modo de un único idioma.
 */
function baseParams(language: string, model: string | undefined, keyterms: string[]): URLSearchParams {
  const multi = isMultilingual(language)
  let m = model || 'nova-3'
  if (!multi && language === 'ca' && m.startsWith('nova-3')) m = 'nova-2'
  const params = new URLSearchParams({
    model: m,
    language: multi ? 'multi' : language,
    punctuate: 'true',
    smart_format: 'true'
  })
  // keyterm solo existe en nova-3; con 20-50 términos rinde mejor que con cientos.
  if (m.startsWith('nova-3')) for (const t of keyterms.slice(0, 50)) params.append('keyterm', t)
  return params
}

/** Idioma más frecuente entre las palabras de un fragmento. */
function dominantLanguage(words: DgWord[]): string | undefined {
  const count = new Map<string, number>()
  for (const w of words) if (w.language) count.set(w.language, (count.get(w.language) ?? 0) + 1)
  let best: string | undefined
  for (const [lang, n] of count) if (!best || n > count.get(best)!) best = lang
  return langCode(best)
}

/**
 * Agrupa palabras consecutivas del mismo hablante. Antes, una racha muy corta de
 * otro hablante entre dos del mismo (típico error de diarización en una muletilla
 * o una palabra solapada) se asigna al hablante que la rodea.
 */
export function wordsToSegments(words: DgWord[], diarize: boolean): RawSegment[] {
  const sp = words.map((w) => (diarize && w.speaker !== undefined ? String(w.speaker) : null))
  if (diarize) {
    let i = 0
    while (i < words.length) {
      let j = i
      while (j + 1 < words.length && sp[j + 1] === sp[i]) j++
      const before = sp[i - 1]
      const after = sp[j + 1]
      const short = j - i + 1 <= 2 && words[j].end - words[i].start < 1
      if (short && before !== undefined && before === after) for (let k = i; k <= j; k++) sp[k] = before
      i = j + 1
    }
  }

  const out: (RawSegment & { words: DgWord[] })[] = []
  words.forEach((w, i) => {
    const text = w.punctuated_word ?? w.word
    const last = out[out.length - 1]
    // Una pausa larga también corta el fragmento, para poder saltar a él al escuchar.
    if (last && last.speaker === sp[i] && w.start - last.end < PAUSE_SPLIT) {
      last.text += ' ' + text
      last.end = w.end
      last.words.push(w)
    } else {
      out.push({ speaker: sp[i], text, start: w.start, end: w.end, words: [w] })
    }
  })
  return out.map(({ words: ws, ...s }) => ({ ...s, lang: dominantLanguage(ws) }))
}

/** Tiempo real con Deepgram: distingue hablantes en directo (diarize=true). */
export function deepgramLive(o: LiveOptions, cb: LiveCallbacks): LiveSession {
  const params = baseParams(o.language, o.model, o.keyterms)
  params.set('encoding', 'linear16')
  params.set('sample_rate', String(SAMPLE_RATE))
  params.set('channels', '1')
  params.set('diarize', String(o.diarize))
  params.set('interim_results', 'true')
  params.set('endpointing', '300')
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${o.apiKey}` }
  })
  let queue: Buffer[] = []
  const keepAlive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }))
  }, 8000)

  ws.on('open', () => {
    cb.onStatus('connected')
    queue.forEach((b) => ws.send(b))
    queue = []
  })
  ws.on('unexpected-response', (_req, res) => {
    cb.onError(`Deepgram ${res.statusCode}: ${res.statusCode === 402 ? 'sin crédito' : 'revisa la API key, el modelo o el idioma'}.`)
  })
  ws.on('message', (data) => {
    let msg: {
      type?: string
      is_final?: boolean
      channel?: { alternatives?: { transcript: string; words: DgWord[] }[] }
      description?: string
    }
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (msg.type === 'Results') {
      const alt = msg.channel?.alternatives?.[0]
      if (!alt || !alt.transcript.trim()) return
      if (msg.is_final) {
        for (const s of wordsToSegments(alt.words, o.diarize)) cb.onSegment(s)
        cb.onPartial('', null)
      } else {
        const segs = wordsToSegments(alt.words, o.diarize)
        cb.onPartial(alt.transcript, segs[segs.length - 1]?.speaker ?? null)
      }
    } else if (msg.type === 'Error') {
      cb.onError(`Deepgram: ${msg.description ?? 'error'}`)
    }
  })
  ws.on('error', (e) => cb.onError(`Deepgram: ${e.message}`))
  ws.on('close', () => {
    clearInterval(keepAlive)
    cb.onStatus('closed')
  })

  return {
    sendAudio(pcm) {
      const b = Buffer.from(pcm)
      if (ws.readyState === WebSocket.OPEN) ws.send(b)
      else if (ws.readyState === WebSocket.CONNECTING) queue.push(b)
    },
    stop() {
      clearInterval(keepAlive)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }))
        setTimeout(() => ws.close(), 3000)
      } else ws.terminate()
    }
  }
}

/** Pasada final con Deepgram pre-recorded. */
export async function deepgramBatch(o: BatchOptions): Promise<RawSegment[]> {
  const params = baseParams(o.language, o.model, o.keyterms)
  params.set('diarize', String(o.diarize))
  const data = await request<{
    results?: { channels?: { alternatives: { words: DgWord[] }[] }[] }
  }>(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${o.apiKey}`, 'Content-Type': 'audio/webm' },
    body: await readFile(o.audioFile)
  })
  return wordsToSegments(data.results?.channels?.[0]?.alternatives[0]?.words ?? [], o.diarize)
}
