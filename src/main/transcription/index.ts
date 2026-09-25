import type { AudioChannel, FinalProvider, Settings } from '../../shared/types'
import { assemblyAiBatch } from './assemblyai'
import { deepgramBatch, deepgramLive } from './deepgram'
import { elevenLabsBatch, elevenLabsLive } from './elevenlabs'
import type { LiveCallbacks, LiveSession, RawSegment } from './types'

export const LIVE_PROVIDER_INFO = {
  deepgram: { diarizes: true, name: 'Deepgram' },
  elevenlabs: { diarizes: false, name: 'ElevenLabs' }
} as const

export function createLiveSession(
  s: Settings,
  channel: AudioChannel,
  cb: LiveCallbacks
): LiveSession | null {
  // El canal del micrófono es siempre "yo": no hace falta separar hablantes.
  const diarize = channel !== 'mic'
  switch (s.liveProvider) {
    case 'deepgram':
      if (!s.keys.deepgram) throw new Error('Falta la API key de Deepgram (Configuración > API keys).')
      return deepgramLive(s.keys.deepgram, s.language, s.deepgramModel, diarize, cb)
    case 'elevenlabs':
      if (!s.keys.elevenlabs) throw new Error('Falta la API key de ElevenLabs (Configuración > API keys).')
      return elevenLabsLive(s.keys.elevenlabs, s.language, cb)
    default:
      return null
  }
}

const KEY_FOR: Record<Exclude<FinalProvider, 'none'>, keyof Settings['keys']> = {
  elevenlabs: 'elevenlabs',
  deepgram: 'deepgram',
  assemblyai: 'assemblyai'
}

export async function transcribeFile(s: Settings, audioFile: string): Promise<RawSegment[]> {
  if (s.finalProvider === 'none') throw new Error('No hay proveedor de transcripción final configurado.')
  const apiKey = s.keys[KEY_FOR[s.finalProvider]]
  if (!apiKey) throw new Error(`Falta la API key de ${s.finalProvider} (Configuración > API keys).`)
  const opts = {
    apiKey,
    audioFile,
    language: s.language,
    expectedSpeakers: s.expectedSpeakers,
    model: s.deepgramModel
  }
  switch (s.finalProvider) {
    case 'elevenlabs':
      return elevenLabsBatch(opts)
    case 'deepgram':
      return deepgramBatch(opts)
    case 'assemblyai':
      return assemblyAiBatch(opts)
  }
}
