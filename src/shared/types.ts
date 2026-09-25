export interface Folder {
  id: string
  name: string
  parentId: string | null
  order: number
}

/** De qué entrada de audio viene un fragmento. */
export type AudioChannel = 'mic' | 'system' | 'mix'

/** Id reservado para la voz del usuario (micrófono). */
export const ME = 'me'
/** Hablantes del audio del sistema cuando el proveedor en vivo no los separa. */
export const OTHERS = 'others'

export interface TranscriptSegment {
  id: string
  speakerId: string
  text: string
  /** Segundos desde el inicio de la grabación. */
  start: number
  end: number
  source: 'live' | 'final'
}

export interface Speaker {
  id: string
  /** Nombre asignado por el usuario; vacío = "Persona N". */
  name: string
  /** Número de persona para la etiqueta por defecto. */
  index: number
}

export interface NoteSection {
  id: string
  title: string
  content: string
  order: number
}

export type MeetingStatus = 'idle' | 'recording' | 'processing' | 'done' | 'error'

export interface Meeting {
  id: string
  title: string
  folderId: string | null
  order: number
  createdAt: string
  durationSec: number
  transcript: TranscriptSegment[]
  speakers: Record<string, Speaker>
  /** true cuando la transcripción ya es la pasada final (más precisa). */
  finalized: boolean
  sections: NoteSection[]
  summary: string | null
  summaryPromptId: string | null
  hasAudio: boolean
  status: MeetingStatus
  error?: string
}

export type MeetingSummary = Pick<
  Meeting,
  'id' | 'title' | 'folderId' | 'order' | 'createdAt' | 'status' | 'durationSec'
>

export type LiveProvider = 'deepgram' | 'elevenlabs' | 'none'
export type FinalProvider = 'elevenlabs' | 'deepgram' | 'assemblyai' | 'none'
export type LlmProvider = 'anthropic' | 'openai'

export interface PromptTemplate {
  id: string
  name: string
  content: string
  builtin?: boolean
}

export interface ApiKeys {
  elevenlabs: string
  deepgram: string
  assemblyai: string
  anthropic: string
  openai: string
}

export interface Settings {
  keys: ApiKeys
  // general
  myName: string
  language: string
  micDeviceId: string
  /** Transcribe el micrófono aparte y lo etiqueta siempre como "yo". */
  separateMic: boolean
  // transcripción
  liveProvider: LiveProvider
  finalProvider: FinalProvider
  expectedSpeakers: number | null
  deepgramModel: string
  // IA
  llmProvider: LlmProvider
  anthropicModel: string
  openaiModel: string
  prompts: PromptTemplate[]
  defaultPromptId: string
  speakerIdPrompt: string
  /** Nombres usados en reuniones anteriores (autocompletado). */
  knownPeople: string[]
}

export type LiveEvent =
  | { type: 'partial'; channel: AudioChannel; speakerId: string; text: string }
  | { type: 'status'; channel: AudioChannel; status: 'connected' | 'closed' }
  | { type: 'error'; message: string }

export type SummaryEvent = { meetingId: string; delta: string }

export interface SpeakerSuggestion {
  speakerId: string
  name: string
  reason: string
}

export const speakerLabel = (s: Speaker | undefined, myName = 'Yo'): string => {
  if (!s) return 'Desconocido'
  if (s.name) return s.name
  if (s.id === ME) return myName || 'Yo'
  if (s.id === OTHERS) return 'Participantes'
  return `Persona ${s.index}`
}
