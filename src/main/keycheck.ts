import type { ApiKeys, KeyCheck } from '../shared/types'
import { classify } from './failures'

/**
 * Comprueba una API key con la petición autenticada más barata de cada proveedor:
 * no transcribe ni genera nada, así que no gasta crédito.
 */

const NAMES: Record<keyof ApiKeys, string> = {
  deepgram: 'Deepgram',
  elevenlabs: 'ElevenLabs',
  assemblyai: 'AssemblyAI',
  anthropic: 'Anthropic',
  openai: 'OpenAI'
}

interface Probe {
  url: string
  init: (key: string) => RequestInit
}

const PROBES: Record<keyof ApiKeys, Probe> = {
  // Devuelve los datos de la key; Deepgram lo documenta para comprobar credenciales.
  deepgram: {
    url: 'https://api.deepgram.com/v1/auth/token',
    init: (k) => ({ headers: { Authorization: `Token ${k}` } })
  },
  // Las keys de ElevenLabs pueden llevar permisos limitados: /v1/user exige user_read,
  // que una key solo de Speech to Text no tiene. Pedir un token de un solo uso para
  // la transcripción en vivo exige justo el permiso que usa la app y no consume crédito.
  elevenlabs: {
    url: 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
    init: (k) => ({ method: 'POST', headers: { 'xi-api-key': k } })
  },
  assemblyai: {
    url: 'https://api.assemblyai.com/v2/transcript?limit=1',
    init: (k) => ({ headers: { Authorization: k } })
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models?limit=1',
    init: (k) => ({ headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } })
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    init: (k) => ({ headers: { Authorization: `Bearer ${k}` } })
  }
}

/** Mensaje de error del cuerpo de la respuesta, venga en el formato que venga. */
function detailOf(body: string): { message: string; code: string } {
  try {
    const j = JSON.parse(body)
    const d = j.detail ?? j.error ?? j
    if (typeof d === 'string') return { message: d, code: '' }
    return {
      message: String(d.message ?? j.message ?? j.err_msg ?? body),
      code: String(d.status ?? d.code ?? d.type ?? j.category ?? '')
    }
  } catch {
    return { message: body, code: '' }
  }
}

export async function checkKey(provider: keyof ApiKeys, key: string): Promise<KeyCheck> {
  const name = NAMES[provider]
  const probe = PROBES[provider]
  key = key.trim()
  if (!probe) return { status: 'error', message: `Proveedor desconocido: ${provider}` }
  if (!key) return { status: 'invalid', message: 'Pega la API key.' }
  // Una key con espacios o saltos de línea en medio no es válida y rompería la cabecera.
  if (/\s/.test(key)) return { status: 'invalid', message: 'La key tiene espacios o saltos de línea: cópiala de nuevo.' }

  let res: Response
  try {
    res = await fetch(probe.url, { ...probe.init(key), signal: AbortSignal.timeout(10_000) })
  } catch {
    return { status: 'network', message: `No se ha podido conectar con ${name}. Revisa la conexión a internet.` }
  }
  if (res.ok) return { status: 'valid', message: `Key válida de ${name}.` }

  const { message, code } = detailOf(await res.text().catch(() => ''))
  // ElevenLabs contesta 401 tanto si la key no existe como si le falta un permiso.
  if (provider === 'elevenlabs' && /missing_permissions/i.test(code + message)) {
    return {
      status: 'forbidden',
      message: 'La key existe, pero no tiene el permiso de Speech to Text. Edítala en ElevenLabs y actívalo.'
    }
  }
  // Una key restringida de OpenAI sin permiso para listar modelos es auténtica: basta para resumir.
  if (provider === 'openai' && /missing scopes|insufficient permissions/i.test(message)) {
    return { status: 'valid', message: `Key válida de ${name}.` }
  }
  if (res.status === 403) {
    return { status: 'forbidden', message: `${name} reconoce la key, pero no tiene permisos suficientes.` }
  }
  if (res.status === 401) {
    return { status: 'invalid', message: `${name} no reconoce esta key. Comprueba que la has copiado entera.` }
  }
  switch (classify(`${res.status} ${message}`)) {
    case 'auth':
      return { status: 'invalid', message: `${name} no reconoce esta key. Comprueba que la has copiado entera.` }
    case 'credits':
      // La key es buena aunque falte saldo: se deja continuar avisando.
      return { status: 'valid', message: `Key válida, pero ${name} indica que no hay crédito. Recarga saldo antes de grabar.` }
    case 'rate':
      return { status: 'error', message: `${name} está limitando las peticiones. Prueba de nuevo en unos segundos.` }
    case 'network':
      return { status: 'network', message: `${name} no responde ahora mismo. Prueba de nuevo en un momento.` }
    default:
      return { status: 'error', message: `${name} ha devuelto un error (${res.status}): ${message.slice(0, 160)}` }
  }
}
