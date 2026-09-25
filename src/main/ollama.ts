import { DEFAULT_OLLAMA_URL, type OllamaModel, type OllamaStatus } from '../shared/types'

/*
 * Ventana de contexto. Ollama usa por defecto una ventana corta y, si el texto no cabe,
 * descarta el principio sin avisar. Aquí se pide la que hace falta (en tramos de 4K para
 * no recargar el modelo en cada petición) y se limita a 32K: una hora de reunión son
 * ~17K tokens y más allá la memoria de la caché se dispara en un portátil (varios GB con un modelo de 8-9B).
 * Si aun así no cabe, se recorta la transcripción por el medio (ver fitTranscript).
 */
const MIN_CTX = 8192
export const MAX_CTX = 32768
/** Aproximación prudente para español: ~3 caracteres por token. */
const CHARS_PER_TOKEN = 3

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

export function contextFor(inputTokens: number, outputTokens: number): number {
  const need = inputTokens + outputTokens + 512
  return Math.min(MAX_CTX, Math.max(MIN_CTX, Math.ceil(need / 4096) * 4096))
}

/** Caracteres de transcripción que caben dejando sitio al resto del documento y a la respuesta. */
export function transcriptBudget(otherChars: number, outputTokens: number): number {
  return Math.max(4000, (MAX_CTX - outputTokens - 512) * CHARS_PER_TOKEN - otherChars)
}

/**
 * Recorta una transcripción demasiado larga quitando líneas del medio: el principio
 * (presentaciones, objetivo) y el final (conclusiones, próximos pasos) suelen ser lo más útil.
 */
export function fitTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const lines = text.split('\n')
  const headBudget = maxChars * 0.6
  const head: string[] = []
  const tail: string[] = []
  let used = 0
  for (const l of lines) {
    if (used + l.length + 1 > headBudget) break
    head.push(l)
    used += l.length + 1
  }
  for (let i = lines.length - 1; i >= head.length; i--) {
    if (used + lines[i].length + 1 > maxChars) break
    tail.unshift(lines[i])
    used += lines[i].length + 1
  }
  const omitted = lines.length - head.length - tail.length
  return [...head, `[… ${omitted} intervenciones omitidas por longitud …]`, ...tail].join('\n')
}

export function normalizeUrl(url: string): string {
  let u = (url || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u
  return u
}

const notRunning = (url: string): Error =>
  new Error(`Ollama no responde en ${url}. Comprueba que está abierto (o instálalo desde https://ollama.com) y vuelve a intentarlo.`)

async function request(url: string, path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const base = normalizeUrl(url)
  let res: Response
  try {
    res = await fetch(base + path, {
      ...init,
      signal: init?.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined
    })
  } catch {
    throw notRunning(base)
  }
  if (res.ok) return res
  const body = await res.text().catch(() => '')
  let detail = body
  try {
    detail = (JSON.parse(body) as { error?: string }).error ?? body
  } catch {
    /* texto plano */
  }
  throw new Error(detail || `HTTP ${res.status}`)
}

export async function ollamaStatus(url: string): Promise<OllamaStatus> {
  try {
    const res = await request(url, '/api/tags', { timeoutMs: 4000 })
    const data = (await res.json()) as {
      models?: { name: string; size: number; details?: { parameter_size?: string; family?: string } }[]
    }
    const models: OllamaModel[] = (data.models ?? [])
      .map((m) => ({ name: m.name, size: m.size, parameterSize: m.details?.parameter_size ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, models }
  } catch (err) {
    return { ok: false, models: [], error: (err as Error).message }
  }
}

interface ChatOptions {
  url: string
  model: string
  system: string
  user: string
  numCtx: number
  format?: object
  temperature?: number
}

/** Traduce los errores de Ollama más habituales a un mensaje claro. */
function explainError(message: string, model: string): Error {
  if (/not found|try pulling/i.test(message)) {
    return new Error(`El modelo "${model}" no está descargado en Ollama. Ejecuta \`ollama pull ${model}\` o elige otro en Configuración > IA para resúmenes.`)
  }
  if (/memory|out of memory|requires more system memory/i.test(message)) {
    return new Error(`No hay memoria suficiente para el modelo "${model}". Prueba con uno más pequeño (p. ej. qwen3.5:4b).`)
  }
  return new Error(`Ollama: ${message}`)
}

async function openChat(o: ChatOptions, stream: boolean, think: boolean | undefined): Promise<Response> {
  return request(o.url, '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: o.model,
      stream,
      // Sin razonamiento previo: en un portátil lo alarga mucho y no mejora un acta.
      ...(think === undefined ? {} : { think }),
      format: o.format,
      options: { num_ctx: o.numCtx, temperature: o.temperature },
      messages: [
        { role: 'system', content: o.system },
        { role: 'user', content: o.user }
      ]
    })
  })
}

/** Abre el chat; si el modelo no admite el parámetro `think`, repite la petición sin él. */
async function chat(o: ChatOptions, stream: boolean): Promise<Response> {
  if (!o.model.trim()) throw new Error('Elige un modelo de Ollama en Configuración > IA para resúmenes.')
  try {
    return await openChat(o, stream, false)
  } catch (err) {
    const message = (err as Error).message
    if (/think/i.test(message)) {
      try {
        return await openChat(o, stream, undefined)
      } catch (e) {
        throw explainError((e as Error).message, o.model)
      }
    }
    if (message.startsWith('Ollama no responde')) throw err
    throw explainError(message, o.model)
  }
}

/** Chat con respuesta en streaming (NDJSON de /api/chat). */
export async function ollamaStream(o: ChatOptions, onDelta: (text: string) => void): Promise<string> {
  const res = await chat(o, true)
  if (!res.body) throw new Error('Ollama no ha devuelto respuesta.')
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  const handle = (line: string): void => {
    if (!line.trim()) return
    const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string }
    if (chunk.error) throw explainError(chunk.error, o.model)
    const text = chunk.message?.content
    if (text) {
      full += text
      onDelta(text)
    }
  }
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(handle)
  }
  handle(buffer + decoder.decode())
  return full
}

/** Chat sin streaming con salida JSON ajustada al esquema. */
export async function ollamaJson(o: ChatOptions & { format: object }): Promise<unknown> {
  const res = await chat(o, false)
  const data = (await res.json()) as { message?: { content?: string } }
  const content = data.message?.content ?? ''
  try {
    return JSON.parse(content)
  } catch {
    throw new Error(`El modelo "${o.model}" no ha devuelto un JSON válido. Prueba otra vez o con un modelo mayor.`)
  }
}
