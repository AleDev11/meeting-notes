import { readFile } from 'fs/promises'
import { request } from './http'
import type { BatchOptions, RawSegment } from './types'

const API = 'https://api.assemblyai.com/v2'

/** Pasada final con AssemblyAI (speaker_labels). */
export async function assemblyAiBatch(o: BatchOptions): Promise<RawSegment[]> {
  const headers = { authorization: o.apiKey }
  const { upload_url } = await request<{ upload_url: string }>(`${API}/upload`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    body: await readFile(o.audioFile)
  })

  const body: Record<string, unknown> = { audio_url: upload_url, speaker_labels: true }
  if (o.language) body.language_code = o.language
  else body.language_detection = true
  if (o.expectedSpeakers) body.speakers_expected = o.expectedSpeakers

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
      utterances?: { speaker: string; text: string; start: number; end: number }[]
    }>(`${API}/transcript/${id}`, { headers })
    if (t.status === 'error') throw new Error(`AssemblyAI: ${t.error}`)
    if (t.status === 'completed') {
      return (t.utterances ?? []).map((u) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start / 1000,
        end: u.end / 1000
      }))
    }
  }
}
