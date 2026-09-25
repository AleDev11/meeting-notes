/**
 * Clasifica los errores de los proveedores (transcripción e IA) para decidir qué hacer:
 * reintentar más tarde, avisar de que falta crédito o pedir que se revise la clave.
 */
export type FailureKind = 'credits' | 'auth' | 'network' | 'rate' | 'other'

const PATTERNS: [FailureKind, RegExp][] = [
  ['credits', /\b402\b|quota|credit|insufficient[_ ]?(funds|balance)|balance|payment required|billing|out of (credit|funds)|character limit|usage limit/i],
  ['auth', /\b401\b|\b403\b|unauthori[sz]ed|invalid[_ ]?(api[_ ]?)?key|authentication|forbidden|api key/i],
  ['rate', /\b429\b|rate[_ ]?limit|too many requests|overloaded|\b529\b/i],
  ['network', /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|socket hang up|getaddrinfo|\b50[234]\b/i]
]

export function classify(message: string): FailureKind {
  return PATTERNS.find(([, re]) => re.test(message))?.[0] ?? 'other'
}

/** Fallos que se arreglan solos o cuando el usuario recarga crédito o corrige la clave. */
export const isRecoverable = (kind: FailureKind): boolean => kind !== 'other'

/** Fallos por los que no tiene sentido reconectar la transcripción en vivo. */
export const isFatalLive = (message: string): boolean => {
  const kind = classify(message)
  return kind === 'credits' || kind === 'auth'
}

export function explain(provider: string, kind: FailureKind): string {
  switch (kind) {
    case 'credits':
      return `${provider} se ha quedado sin crédito`
    case 'auth':
      return `${provider} ha rechazado la API key`
    case 'rate':
      return `${provider} está saturado o ha limitado las peticiones`
    case 'network':
      return `No se ha podido conectar con ${provider}`
    default:
      return `${provider} ha devuelto un error`
  }
}
