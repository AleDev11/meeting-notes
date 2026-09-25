/** Fragmento devuelto por un proveedor, con la etiqueta de hablante "cruda". */
export interface RawSegment {
  /** null = el proveedor no distingue hablantes en este canal. */
  speaker: string | null
  text: string
  start: number
  end: number
}

export interface LiveCallbacks {
  onSegment: (s: RawSegment) => void
  onPartial: (text: string, speaker: string | null) => void
  onStatus: (status: 'connected' | 'closed') => void
  onError: (message: string) => void
}

export interface LiveSession {
  /** Audio PCM16 LE mono 16 kHz. */
  sendAudio(pcm: Uint8Array): void
  stop(): void
}

export interface BatchOptions {
  apiKey: string
  audioFile: string
  language: string
  expectedSpeakers: number | null
  model?: string
}

export const SAMPLE_RATE = 16000
export const BYTES_PER_SECOND = SAMPLE_RATE * 2
