/** Fragmento devuelto por un proveedor, con la etiqueta de hablante "cruda". */
export interface RawSegment {
  /** null = el proveedor no distingue hablantes en este canal. */
  speaker: string | null
  text: string
  start: number
  end: number
  /** Idioma detectado, si el proveedor lo indica. */
  lang?: string
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

export interface LiveOptions {
  apiKey: string
  languages: string[]
  diarize: boolean
  keyterms: string[]
  model?: string
}

export interface BatchOptions {
  apiKey: string
  audioFile: string
  languages: string[]
  diarize: boolean
  expectedSpeakers: number | null
  keyterms: string[]
  model?: string
}

export const SAMPLE_RATE = 16000
export const BYTES_PER_SECOND = SAMPLE_RATE * 2

const ISO3: Record<string, string> = {
  spa: 'es',
  eng: 'en',
  cat: 'ca',
  por: 'pt',
  fra: 'fr',
  fre: 'fr',
  deu: 'de',
  ger: 'de',
  ita: 'it',
  nld: 'nl',
  dut: 'nl',
  glg: 'gl',
  eus: 'eu',
  baq: 'eu'
}

/** Código de idioma de dos letras a partir de "es", "es-ES" o "spa". */
export function langCode(code: string | undefined): string | undefined {
  if (!code) return undefined
  const base = code.toLowerCase().split(/[-_]/)[0]
  return base.length === 3 ? ISO3[base] : base
}

/** Segundos de silencio a partir de los que un mismo hablante empieza fragmento nuevo. */
export const PAUSE_SPLIT = 1.2
