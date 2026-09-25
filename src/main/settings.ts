import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { normalizeGlossary } from '../shared/glossary'
import { DEFAULT_OLLAMA_URL, RECOMMENDED_OLLAMA_MODEL } from '../shared/types'
import type { ApiKeys, KeySource, PromptTemplate, Settings } from '../shared/types'

const COMMON_RULES = `Usa los nombres de los hablantes tal y como aparecen. No inventes información que no esté en la transcripción o en las notas. Responde en el idioma de la reunión, en Markdown.`

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  {
    id: 'general',
    name: 'Acta general',
    builtin: true,
    content: `Eres un asistente que redacta actas de reuniones de trabajo a partir de la transcripción (con hablantes) y de las notas del usuario.

Genera:
## Resumen
Un párrafo breve con el objetivo y el resultado de la reunión.
## Participantes
Quién intervino y su papel aparente.
## Puntos clave
Temas tratados, agrupados por las secciones de notas del usuario cuando existan.
## Decisiones
## Acciones
Tabla: Responsable | Tarea | Fecha (si se menciona)
## Preguntas abiertas y riesgos

${COMMON_RULES}`
  },
  {
    id: 'one-on-one',
    name: 'Reunión 1:1',
    builtin: true,
    content: `Resume esta reunión 1:1 entre dos personas.

## Resumen
## Temas tratados
## Feedback dado y recibido
## Compromisos de cada persona
## Temas para la próxima 1:1

${COMMON_RULES}`
  },
  {
    id: 'daily',
    name: 'Daily / seguimiento',
    builtin: true,
    content: `Resume esta reunión de seguimiento de equipo. Para cada participante indica:
- Qué ha hecho
- Qué va a hacer
- Bloqueos

Después añade:
## Bloqueos que requieren acción
## Acciones (Responsable | Tarea)

${COMMON_RULES}`
  },
  {
    id: 'client',
    name: 'Reunión con cliente',
    builtin: true,
    content: `Resume esta reunión con un cliente.

## Contexto y objetivo
## Necesidades y problemas planteados por el cliente
## Propuestas y compromisos de nuestra parte
## Objeciones o dudas del cliente
## Próximos pasos (Responsable | Tarea | Fecha)
## Email de seguimiento
Un borrador breve y profesional para enviar al cliente.

${COMMON_RULES}`
  },
  {
    id: 'interview',
    name: 'Entrevista',
    builtin: true,
    content: `Resume esta entrevista.

## Perfil del entrevistado
## Preguntas y respuestas clave
## Puntos fuertes
## Puntos de mejora o dudas
## Valoración y siguientes pasos

${COMMON_RULES}`
  }
]

export const DEFAULT_SPEAKER_ID_PROMPT = `Analiza la transcripción de una reunión en la que los hablantes aparecen con etiquetas genéricas ("Persona 1", "Persona 2"...).
Deduce el nombre real de cada etiqueta usando pistas del contexto: cuando alguien se presenta ("soy Marta"), cuando le llaman por su nombre ("gracias, Luis", "Ana, ¿qué opinas?"), o por el turno de palabra justo después de ser nombrado.
Solo propone un nombre si hay evidencia razonable. Para cada propuesta explica brevemente la evidencia. Si no hay evidencia para una etiqueta, no la incluyas.`

const defaultKeys: ApiKeys = {
  elevenlabs: '',
  deepgram: '',
  assemblyai: '',
  anthropic: '',
  openai: ''
}

const defaults: Settings = {
  keys: defaultKeys,
  myName: '',
  languages: ['es'],
  micDeviceId: '',
  separateMic: true,
  recordScreen: false,
  screenDisplayId: '',
  askScreen: true,
  liveProvider: 'deepgram',
  finalProvider: 'elevenlabs',
  expectedSpeakers: null,
  deepgramModel: 'nova-3',
  glossary: [],
  llmProvider: 'anthropic',
  anthropicModel: 'claude-opus-5',
  openaiModel: 'gpt-5',
  ollamaUrl: DEFAULT_OLLAMA_URL,
  ollamaModel: RECOMMENDED_OLLAMA_MODEL,
  prompts: BUILTIN_PROMPTS,
  defaultPromptId: 'general',
  speakerIdPrompt: DEFAULT_SPEAKER_ID_PROMPT,
  knownPeople: [],
  openAtLogin: false,
  minimizeToTray: true,
  closeToTray: true,
  onboardingDone: false
}

/** Con una key de transcripción la app ya es usable: no hace falta el asistente de primer uso. */
const hasTranscriptionKey = (k: ApiKeys): boolean => !!(k.elevenlabs || k.deepgram || k.assemblyai)

const file = (): string => join(app.getPath('userData'), 'settings.json')

function encrypt(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value
  return 'enc:' + safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (!value?.startsWith('enc:')) return value ?? ''
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  } catch {
    return ''
  }
}

const ENV_NAMES: Record<keyof ApiKeys, string> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  assemblyai: 'ASSEMBLYAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY'
}

/**
 * Keys de respaldo desde `.env.local` (raíz del proyecto) o variables de entorno.
 * Sirve para llevar el proyecto a otro equipo: allí las keys cifradas de
 * settings.json no se pueden descifrar (DPAPI está ligado al usuario de Windows).
 */
function envKeys(): Partial<Record<keyof ApiKeys, { value: string; source: KeySource }>> {
  const vars: Record<string, string> = {}
  for (const dir of [app.getAppPath(), process.cwd()]) {
    const f = join(dir, '.env.local')
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !line.trim().startsWith('#')) vars[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    break
  }
  const out: Partial<Record<keyof ApiKeys, { value: string; source: KeySource }>> = {}
  for (const [k, name] of Object.entries(ENV_NAMES) as [keyof ApiKeys, string][]) {
    if (process.env[name]) out[k] = { value: process.env[name]!, source: 'env' }
    else if (vars[name]) out[k] = { value: vars[name], source: 'file' }
  }
  return out
}

function withEnvKeys(keys: ApiKeys): ApiKeys {
  const env = envKeys()
  const out = { ...keys }
  for (const k of Object.keys(out) as (keyof ApiKeys)[]) if (!out[k] && env[k]) out[k] = env[k]!.value
  return out
}

/** De dónde sale cada key disponible: guardada en la app, del archivo .env.local o de una variable de entorno. */
export function keySources(): Partial<Record<keyof ApiKeys, KeySource>> {
  const out: Partial<Record<keyof ApiKeys, KeySource>> = {}
  const env = envKeys()
  const raw: Partial<ApiKeys> = existsSync(file()) ? ((JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>).keys ?? {}) : {}
  for (const k of Object.keys(defaultKeys) as (keyof ApiKeys)[]) {
    const saved = decrypt(raw[k] ?? '')
    // Al guardar la configuración se copian también las keys de .env.local: si coinciden, el origen es ese.
    if (env[k] && (!saved || saved === env[k]!.value)) out[k] = env[k]!.source
    else if (saved) out[k] = 'saved'
  }
  return out
}

export function loadSettings(): Settings {
  if (!existsSync(file())) {
    const keys = withEnvKeys({ ...defaultKeys })
    return { ...structuredClone(defaults), keys, onboardingDone: hasTranscriptionKey(keys) }
  }
  const { language, ...raw } = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings> & { language?: string }
  let keys = { ...defaultKeys, ...(raw.keys ?? {}) }
  for (const k of Object.keys(keys) as (keyof ApiKeys)[]) keys[k] = decrypt(keys[k])
  keys = withEnvKeys(keys)
  const { vocabulary, ...rest } = raw as Partial<Settings> & { vocabulary?: string[] }
  const s: Settings = { ...structuredClone(defaults), ...rest, keys }
  // Con una key de transcripción (guardada o de .env.local) no se muestra el asistente.
  s.onboardingDone = !!raw.onboardingDone || hasTranscriptionKey(keys)
  // Antes se guardaba un único idioma. 'multi' (o '') era "Varios idiomas": en la práctica español,
  // catalán e inglés, que es lo que se habla en estas reuniones.
  if (!raw.languages && language !== undefined) {
    s.languages = language && language !== 'multi' ? [language] : ['es', 'ca', 'en']
  }
  // El antiguo vocabulario (solo términos) pasa al glosario sin significado.
  s.glossary = normalizeGlossary([
    ...(Array.isArray(s.glossary) ? s.glossary : []),
    ...(vocabulary ?? []).map((term) => ({ term, meaning: '' }))
  ])
  // Asegura que las plantillas integradas existen aunque el usuario borre alguna.
  for (const p of BUILTIN_PROMPTS) {
    if (!s.prompts.some((x) => x.id === p.id)) s.prompts.push(p)
  }
  return s
}

export function saveSettings(s: Settings): void {
  const keys = { ...s.keys }
  for (const k of Object.keys(keys) as (keyof ApiKeys)[]) keys[k] = encrypt(keys[k])
  writeFileSync(file(), JSON.stringify({ ...s, keys }, null, 2))
}

export function rememberPeople(names: string[]): void {
  const s = loadSettings()
  const set = new Set(s.knownPeople)
  let changed = false
  for (const n of names.map((x) => x.trim()).filter(Boolean)) {
    if (!set.has(n)) {
      set.add(n)
      changed = true
    }
  }
  if (changed) saveSettings({ ...s, knownPeople: [...set].sort((a, b) => a.localeCompare(b)) })
}
