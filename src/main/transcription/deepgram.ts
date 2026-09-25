import { readFile } from 'fs/promises'
import WebSocket from 'ws'
import { request } from './http'
import {
  SAMPLE_RATE,
  type BatchOptions,
  type LiveCallbacks,
  type LiveSession,
  type RawSegment
} from './types'

interface DgWord {
  word: string
  punctuated_word?: string
  start: number
  end: number
  speaker?: number
}

function wordsToSegments(words: DgWord[], diarize: boolean): RawSegment[] {
  const out: RawSegment[] = []
  for (const w of words) {
    const speaker = diarize && w.speaker !== undefined ? String(w.speaker) : null
    const text = w.punctuated_word ?? w.word
    const last = out[out.length - 1]
    if (last && last.speaker === speaker) {
      last.text += ' ' + text
      last.end = w.end
    } else {
      out.push({ speaker, text, start: w.start, end: w.end })
    }
  }
  return out
}

/** Tiempo real con Deepgram: SÍ distingue hablantes en directo (diarize=true). */
export function deepgramLive(
  apiKey: string,
  language: string,
  model: string,
  diarize: boolean,
  cb: LiveCallbacks
): LiveSession {
  const params = new URLSearchParams({
    model: model || 'nova-3',
    encoding: 'linear16',
    sample_rate: String(SAMPLE_RATE),
    channels: '1',
    diarize: String(diarize),
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: '300',
    language: language || 'multi'
  })
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${apiKey}` }
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
    cb.onError(`Deepgram ${res.statusCode}: revisa la API key, el modelo o el idioma.`)
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
        for (const s of wordsToSegments(alt.words, diarize)) cb.onSegment(s)
        cb.onPartial('', null)
      } else {
        const first = alt.words[0]
        const sp = diarize && first?.speaker !== undefined ? String(first.speaker) : null
        cb.onPartial(alt.transcript, sp)
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

/** Pasada final con Deepgram pre-recorded + diarize. */
export async function deepgramBatch(o: BatchOptions): Promise<RawSegment[]> {
  const params = new URLSearchParams({
    model: o.model || 'nova-3',
    diarize: 'true',
    punctuate: 'true',
    smart_format: 'true',
    utterances: 'true',
    language: o.language || 'multi'
  })
  const data = await request<{
    results?: {
      utterances?: { speaker: number; transcript: string; start: number; end: number }[]
      channels?: { alternatives: { words: DgWord[] }[] }[]
    }
  }>(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${o.apiKey}`, 'Content-Type': 'audio/webm' },
    body: await readFile(o.audioFile)
  })
  const utt = data.results?.utterances
  if (utt?.length) {
    return utt.map((u) => ({
      speaker: String(u.speaker),
      text: u.transcript,
      start: u.start,
      end: u.end
    }))
  }
  return wordsToSegments(data.results?.channels?.[0]?.alternatives[0]?.words ?? [], true)
}
