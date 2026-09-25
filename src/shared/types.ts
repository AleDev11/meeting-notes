export interface Folder {
  id: string
  name: string
  parentId: string | null
  order: number
}

/** De qué entrada de audio viene un fragmento. */
export type AudioChannel = 'mic' | 'system' | 'mix'

/** Ficheros que se graban de una reunión: las pistas de audio y la pantalla. */
export type RecordingTrack = AudioChannel | 'screen'

/** Pantalla que se puede grabar. */
export interface ScreenSource {
  id: string
  /** Identificador del monitor, estable entre sesiones. */
  displayId: string
  label: string
  thumbnail: string
}

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
  /** Idioma detectado (código ISO 639-1), si el proveedor lo indica. */
  lang?: string
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

/** pending: la transcripción final no se pudo hacer (sin crédito, sin conexión…) y se reintentará sola. */
export type MeetingStatus = 'idle' | 'recording' | 'processing' | 'pending' | 'done' | 'error'

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
  /** Se grabó también la pantalla (screen.mp4). */
  hasScreen?: boolean
  /** Segundo de la reunión en que empieza el vídeo, si se activó a mitad de grabación. */
  screenOffset?: number
  status: MeetingStatus
  error?: string
}

/** Resultado de buscar en la biblioteca. El fragmento marca cada coincidencia entre los caracteres U+0001 y U+0002. */
export interface SearchResult {
  id: string
  title: string
  createdAt: string
  folderId: string | null
  snippet: string
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
  /** Idiomas que se hablan en las reuniones. Vacío = detectar cualquiera. */
  languages: string[]
  micDeviceId: string
  /** Transcribe el micrófono aparte y lo etiqueta siempre como "yo". */
  separateMic: boolean
  /** Grabar también la pantalla y cuál (identificador del monitor). */
  recordScreen: boolean
  screenDisplayId: string
  /** Preguntar al empezar cada grabación si se graba la pantalla. */
  askScreen: boolean
  // transcripción
  liveProvider: LiveProvider
  finalProvider: FinalProvider
  /** Personas en la reunión, contándote a ti. */
  expectedSpeakers: number | null
  deepgramModel: string
  /** Nombres propios y términos que el reconocimiento de voz debe esperar. */
  vocabulary: string[]
  // IA
  llmProvider: LlmProvider
  anthropicModel: string
  openaiModel: string
  prompts: PromptTemplate[]
  defaultPromptId: string
  speakerIdPrompt: string
  /** Nombres usados en reuniones anteriores (autocompletado). */
  knownPeople: string[]
  // segundo plano
  openAtLogin: boolean
  /** Al minimizar, ocultar la ventana y seguir en la bandeja del sistema. */
  minimizeToTray: boolean
  /** Al cerrar la ventana, seguir en la bandeja en lugar de salir. */
  closeToTray: boolean
}

/** Acciones rápidas desde la bandeja o el icono de la barra de tareas. */
export type AppAction = 'open' | 'new-meeting' | 'record' | 'stop' | 'pause' | 'mini' | 'stop-and-quit' | 'toggle-screen'

export type LiveEvent =
  | { type: 'partial'; channel: AudioChannel; speakerId: string; text: string }
  | { type: 'status'; channel: AudioChannel; status: 'connected' | 'closed' }
  | { type: 'error'; message: string }
  /** La transcripción en vivo se ha detenido (sin crédito, clave rechazada) pero se sigue grabando. */
  | { type: 'degraded'; channel: AudioChannel; message: string }

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

/** Línea de la transcripción que se muestra en el modo mini. */
export interface MiniLine {
  id: string
  speaker: string
  color: string
  text: string
  partial?: boolean
}

/** Estado de una fuente de audio durante la grabación. */
export type SourceState = 'off' | 'on' | 'muted'

export interface MiniState {
  title: string
  recording: boolean
  paused: boolean
  /** Aviso cuando la transcripción en vivo se ha detenido pero se sigue grabando. */
  notice?: string
  elapsed: number
  mic: SourceState
  system: SourceState
  screen: boolean
  lines: MiniLine[]
}

export type MiniCommand = 'pause' | 'resume' | 'toggleMic' | 'toggleSystem' | 'toggleScreen' | 'stop' | 'expand'

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  /** Versión disponible (al descargar o lista para instalar). */
  version?: string
  percent?: number
  releaseUrl?: string
  error?: string
}
