import type { AudioChannel, FinalProvider, Settings } from '../../shared/types'
import { assemblyAiBatch } from './assemblyai'
import { deepgramBatch, deepgramLive } from './deepgram'
import { elevenLabsBatch, elevenLabsLive } from './elevenlabs'
import { BYTES_PER_SECOND, type LiveCallbacks, type LiveSession, type RawSegment } from './types'

export const LIVE_PROVIDER_INFO = {
  deepgram: { diarizes: true, name: 'Deepgram' },
  elevenlabs: { diarizes: false, name: 'ElevenLabs' }
} as const

/** Nombres y términos que el reconocimiento debe esperar (personas conocidas y vocabulario). */
export function keytermsFor(s: Settings): string[] {
  const terms = [s.myName, ...s.knownPeople, ...s.vocabulary].map((t) => t.trim()).filter((t) => t && t.length < 50)
  return [...new Set(terms)]
}

const MAX_RETRIES = 5

/**
 * Sesión en vivo que se reconecta sola si el proveedor corta la conexión a mitad
 * de reunión. Cada reconexión empieza su reloj en cero y numera los hablantes de
 * nuevo, así que se desplazan los tiempos y se distinguen sus etiquetas.
 */
export function resilient(open: (cb: LiveCallbacks) => LiveSession, cb: LiveCallbacks): LiveSession {
  let bytes = 0
  let generation = 0
  let retries = 0
  let everConnected = false
  let stopped = false
  let session: LiveSession

  const connect = (): void => {
    const gen = generation
    const offset = bytes / BYTES_PER_SECOND
    const tag = (sp: string | null): string | null => (sp === null || gen === 0 ? sp : `${gen}.${sp}`)
    session = open({
      onSegment: (s) => cb.onSegment({ ...s, speaker: tag(s.speaker), start: s.start + offset, end: s.end + offset }),
      onPartial: (text, sp) => cb.onPartial(text, tag(sp)),
      onError: cb.onError,
      onStatus: (status) => {
        if (status === 'connected') {
          everConnected = true
          retries = 0
          cb.onStatus(status)
        } else if (!stopped && gen === generation && everConnected && retries < MAX_RETRIES) {
          retries++
          generation++
          setTimeout(() => !stopped && connect(), 1000 * retries)
        } else if (gen === generation) {
          if (!stopped && everConnected) cb.onError('Se ha perdido la conexión de la transcripción en vivo. La grabación continúa.')
          cb.onStatus(status)
        }
      }
    })
  }
  connect()

  return {
    sendAudio(pcm) {
      bytes += pcm.byteLength
      session.sendAudio(pcm)
    },
    stop() {
      stopped = true
      session.stop()
    }
  }
}

export function createLiveSession(
  s: Settings,
  channel: AudioChannel,
  cb: LiveCallbacks
): LiveSession | null {
  // El canal del micrófono es siempre "yo": no hace falta separar hablantes.
  const opts = { language: s.language, diarize: channel !== 'mic', keyterms: keytermsFor(s) }
  switch (s.liveProvider) {
    case 'deepgram': {
      const apiKey = s.keys.deepgram
      if (!apiKey) throw new Error('Falta la API key de Deepgram (Configuración > API keys).')
      return resilient((c) => deepgramLive({ ...opts, apiKey, model: s.deepgramModel }, c), cb)
    }
    case 'elevenlabs': {
      const apiKey = s.keys.elevenlabs
      if (!apiKey) throw new Error('Falta la API key de ElevenLabs (Configuración > API keys).')
      return resilient((c) => elevenLabsLive({ ...opts, apiKey }, c), cb)
    }
    default:
      return null
  }
}

const KEY_FOR: Record<Exclude<FinalProvider, 'none'>, keyof Settings['keys']> = {
  elevenlabs: 'elevenlabs',
  deepgram: 'deepgram',
  assemblyai: 'assemblyai'
}

export async function transcribeFile(
  s: Settings,
  audioFile: string,
  o: { diarize: boolean; expectedSpeakers: number | null }
): Promise<RawSegment[]> {
  if (s.finalProvider === 'none') throw new Error('No hay proveedor de transcripción final configurado.')
  const apiKey = s.keys[KEY_FOR[s.finalProvider]]
  if (!apiKey) throw new Error(`Falta la API key de ${s.finalProvider} (Configuración > API keys).`)
  const opts = {
    apiKey,
    audioFile,
    language: s.language,
    diarize: o.diarize,
    expectedSpeakers: o.expectedSpeakers,
    keyterms: keytermsFor(s),
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
