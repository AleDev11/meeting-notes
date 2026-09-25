import { readFile } from 'fs/promises'
import WebSocket from 'ws'
import { isMultilingual } from '../../shared/languages'
import { FormData, request } from './http'
import {
  BYTES_PER_SECOND,
  langCode,
  PAUSE_SPLIT,
  SAMPLE_RATE,
  type BatchOptions,
  type LiveCallbacks,
  type LiveOptions,
  type LiveSession,
  type RawSegment
} from './types'

/**
 * Tiempo real con scribe_v2_realtime. Este endpoint NO distingue hablantes:
 * los segmentos llegan con speaker = null. Sin language_code detecta el idioma
 * y lo cambia sobre la marcha, catalán incluido. Con varios idiomas se pasan
 * como secondary_languages y ninguno como principal: fijar uno (sobre todo el
 * catalán) hace que el resto se traduzca a ese idioma.
 */
export function elevenLabsLive(o: LiveOptions, cb: LiveCallbacks): LiveSession {
  const params = new URLSearchParams({
    model_id: 'scribe_v2_realtime',
    audio_format: `pcm_${SAMPLE_RATE}`,
    commit_strategy: 'vad',
    include_timestamps: 'true',
    include_language_detection: 'true'
  })
  if (!isMultilingual(o.languages)) params.set('language_code', o.languages[0])
  else for (const l of o.languages) params.append('secondary_languages', l)
  for (const t of o.keyterms) params.append('keyterms', t)
  const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`, {
    headers: { 'xi-api-key': o.apiKey }
  })
  let queue: string[] = []
  let bytesSent = 0
  let lastCommit = 0
  // Tras cada fragmento llega una copia con marcas de tiempo e idioma detectado.
  let pending: RawSegment | null = null
  const flush = (lang?: string): void => {
    if (pending) cb.onSegment(lang ? { ...pending, lang } : pending)
    pending = null
  }

  ws.on('open', () => {
    cb.onStatus('connected')
    queue.forEach((m) => ws.send(m))
    queue = []
  })
  ws.on('message', (data) => {
    let msg: { message_type?: string; text?: string; language_code?: string | null; error?: string; message?: string }
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    const now = bytesSent / BYTES_PER_SECOND
    switch (msg.message_type) {
      case 'partial_transcript':
        cb.onPartial(msg.text ?? '', null)
        break
      case 'committed_transcript':
        flush()
        if (msg.text?.trim()) pending = { speaker: null, text: msg.text.trim(), start: lastCommit, end: now }
        lastCommit = now
        break
      case 'committed_transcript_with_timestamps':
        flush(langCode(msg.language_code ?? undefined))
        break
      case 'session_started':
      case 'committed_transcript_entities':
      case 'warning':
      // Aviso de que no había audio pendiente al cerrar: no es un error.
      case 'commit_throttled':
        break
      default:
        if (msg.error || msg.message) cb.onError(`ElevenLabs (${msg.message_type}): ${msg.error ?? msg.message}`)
    }
  })
  ws.on('error', (e) => cb.onError(`ElevenLabs: ${e.message}`))
  ws.on('close', () => {
    flush()
    cb.onStatus('closed')
  })

  const chunk = (pcm: Uint8Array, commit: boolean): string =>
    JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: Buffer.from(pcm).toString('base64'),
      commit,
      sample_rate: SAMPLE_RATE
    })

  return {
    sendAudio(pcm) {
      bytesSent += pcm.byteLength
      const msg = chunk(pcm, false)
      if (ws.readyState === WebSocket.OPEN) ws.send(msg)
      else if (ws.readyState === WebSocket.CONNECTING) queue.push(msg)
    },
    stop() {
      if (ws.readyState === WebSocket.OPEN) {
        // ElevenLabs exige al menos 0,3 s sin confirmar para cerrar el último fragmento.
        if (bytesSent / BYTES_PER_SECOND - lastCommit >= 0.3) ws.send(chunk(new Uint8Array(0), true))
        setTimeout(() => ws.close(), 1500)
      } else ws.terminate()
    }
  }
}

interface ScribeWord {
  text: string
  type: 'word' | 'spacing' | 'audio_event'
  start: number
  end: number
  speaker_id?: string | null
}

/** Pasada final con scribe_v2 (hasta 32 hablantes, detección automática de idioma). */
export async function elevenLabsBatch(o: BatchOptions): Promise<RawSegment[]> {
  const form = new FormData()
  form.set('model_id', 'scribe_v2')
  form.set('file', new Blob([await readFile(o.audioFile)], { type: 'audio/webm' }), 'audio.webm')
  form.set('diarize', String(o.diarize))
  form.set('timestamps_granularity', 'word')
  form.set('tag_audio_events', 'false')
  // Sin language_code transcribe cada parte en su idioma aunque se mezclen en el mismo archivo.
  if (!isMultilingual(o.languages)) form.set('language_code', o.languages[0])
  if (o.diarize && o.expectedSpeakers) form.set('num_speakers', String(o.expectedSpeakers))
  for (const t of o.keyterms) form.append('keyterms', t)

  const data = await request<{ words?: ScribeWord[]; language_code?: string }>(
    'https://api.elevenlabs.io/v1/speech-to-text',
    { method: 'POST', headers: { 'xi-api-key': o.apiKey }, body: form }
  )

  const lang = langCode(data.language_code)
  const out: RawSegment[] = []
  for (const w of data.words ?? []) {
    if (w.type === 'audio_event') continue
    const last = out[out.length - 1]
    const speaker = o.diarize ? (w.speaker_id ?? null) : null
    if (last && w.type === 'spacing') last.text += w.text
    else if (last && last.speaker === speaker && w.start - last.end < PAUSE_SPLIT) {
      last.text += w.text
      last.end = w.end
    } else if (w.type === 'word') {
      out.push({ speaker, text: w.text, start: w.start, end: w.end, lang })
    }
  }
  return out.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text)
}
