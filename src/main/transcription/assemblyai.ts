import { readFile } from 'fs/promises'
import { request } from './http'
import { isMultilingual } from '../../shared/languages'
import { langCode, PAUSE_SPLIT, type BatchOptions, type RawSegment } from './types'

const API = 'https://api.assemblyai.com/v2'

/** Pasada final con AssemblyAI (speaker_labels). */
export async function assemblyAiBatch(o: BatchOptions): Promise<RawSegment[]> {
  const headers = { authorization: o.apiKey }
  const { upload_url } = await request<{ upload_url: string }>(`${API}/upload`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    body: await readFile(o.audioFile)
  })

  const body: Record<string, unknown> = { audio_url: upload_url, speaker_labels: o.diarize }
  const catalan = !isMultilingual(o.languages) && o.languages[0] === 'ca'
  if (isMultilingual(o.languages)) {
    body.language_detection = true
    body.language_detection_options = { code_switching: true }
  } else {
    body.language_code = o.languages[0]
    // El catalán solo lo reconoce universal-2.
    if (catalan) body.speech_models = ['universal-2']
  }
  if (o.diarize && o.expectedSpeakers) body.speakers_expected = o.expectedSpeakers
  // Con universal-2 (el modelo del catalán) solo se admite vocabulario en inglés.
  if (o.keyterms.length && !catalan) body.keyterms_prompt = o.keyterms.slice(0, 200)

  const { id } = await request<{ id: string }>(`${API}/transcript`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

  for (;;) {
    await new Promise((r) => setTimeout(r, 3000))
    const t = await request<{
      status: 'queued' | 'processing' | 'completed' | 'error'
      error?: string
      language_code?: string
      words?: { text: string; start: number; end: number }[]
      utterances?: { speaker: string; text: string; start: number; end: number }[] | null
    }>(`${API}/transcript/${id}`, { headers })
    if (t.status === 'error') throw new Error(`AssemblyAI: ${t.error}`)
    if (t.status === 'completed') {
      const lang = langCode(t.language_code)
      if (!o.diarize || !t.utterances) {
        const out: RawSegment[] = []
        for (const w of t.words ?? []) {
          const last = out[out.length - 1]
          const start = w.start / 1000
          if (last && start - last.end < PAUSE_SPLIT) {
            last.text += ' ' + w.text
            last.end = w.end / 1000
          } else out.push({ speaker: null, text: w.text, start, end: w.end / 1000, lang })
        }
        return out
      }
      return t.utterances.map((u) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start / 1000,
        end: u.end / 1000,
        lang
      }))
    }
  }
}
