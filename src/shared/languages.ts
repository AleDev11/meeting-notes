import type { FinalProvider, LiveProvider, Settings } from './types'

export const LANGUAGES: [code: string, label: string][] = [
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['ca', 'Catalán'],
  ['pt', 'Portugués'],
  ['fr', 'Francés'],
  ['de', 'Alemán'],
  ['it', 'Italiano']
]

/** Idiomas que Deepgram Nova-3 mezcla en modo multilingüe. */
const DEEPGRAM_MULTI = new Set(['en', 'es', 'fr', 'de', 'hi', 'ru', 'pt', 'ja', 'it', 'nl'])

/** true si se mezclan idiomas (o no se sabe cuáles): el proveedor debe detectarlos. */
export const isMultilingual = (languages: string[]): boolean => languages.length !== 1

/**
 * Deepgram y AssemblyAI no reconocen el catalán cuando se mezcla con otros idiomas
 * (lo transcriben como un español ininteligible). ElevenLabs sí.
 */
export const needsElevenLabs = (languages: string[]): boolean =>
  languages.length > 1 && languages.some((l) => !DEEPGRAM_MULTI.has(l))

/** Proveedor en vivo que se usa de verdad: con catalán mezclado se pasa a ElevenLabs si hay key. */
export function liveProviderFor(s: Settings): LiveProvider {
  if (s.liveProvider === 'deepgram' && needsElevenLabs(s.languages) && s.keys.elevenlabs) return 'elevenlabs'
  return s.liveProvider
}

export function finalProviderFor(s: Settings): FinalProvider {
  if ((s.finalProvider === 'deepgram' || s.finalProvider === 'assemblyai') && needsElevenLabs(s.languages) && s.keys.elevenlabs) {
    return 'elevenlabs'
  }
  return s.finalProvider
}

export const languageNames = (languages: string[]): string =>
  languages.map((l) => LANGUAGES.find(([c]) => c === l)?.[1].toLowerCase() ?? l).join(', ')
