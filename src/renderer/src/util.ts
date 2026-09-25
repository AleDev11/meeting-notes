import { ME, OTHERS } from '@shared/types'

export function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(h ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} s`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Hoy, ${time}`
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`
}

const PALETTE = ['#7aa7e8', '#62c29a', '#e2a85c', '#e3808a', '#a693e2', '#56bccb', '#d68e62', '#b3c25b']

export function speakerColor(id: string, index: number): string {
  if (id === ME) return '#a8a8b0'
  if (id === OTHERS) return '#74747e'
  return PALETTE[(Math.max(1, index) - 1) % PALETTE.length]
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/)
  if (/^Persona \d+$/.test(label)) return `P${parts[1]}`
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const CAPTURE_ERRORS: Record<string, string> = {
  OverconstrainedError: 'El micrófono elegido no está disponible. Elige otro en la flecha junto a Micrófono.',
  NotFoundError: 'No se ha encontrado ningún micrófono. Conecta uno o desactiva Micrófono.',
  NotReadableError: 'No se puede usar el micrófono: puede que otra aplicación lo esté usando en exclusiva.',
  NotAllowedError: 'Windows no ha dado permiso para capturar el audio. Revisa la privacidad del micrófono en Configuración de Windows.',
  AbortError: 'Se ha interrumpido la captura de audio. Vuelve a intentarlo.'
}

export function errorMessage(e: unknown): string {
  const err = e as Error | undefined
  const text = String(err?.message ?? e ?? '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim()
  if (err?.name && CAPTURE_ERRORS[err.name]) return text ? `${CAPTURE_ERRORS[err.name]} (${text})` : CAPTURE_ERRORS[err.name]
  return text || `Ha ocurrido un error inesperado${err?.name && err.name !== 'Error' ? ` (${err.name})` : ''}.`
}

/** Minúsculas y sin tildes, carácter a carácter (mantiene la correspondencia de posiciones). */
const fold = (c: string): string => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Parte un texto en trozos marcando las palabras que empiezan por alguno de los
 * términos buscados, sin distinguir mayúsculas ni tildes (igual que el buscador).
 */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const terms = query.split(/\s+/).map(fold).filter(Boolean)
  if (!terms.length) return [{ text, hit: false }]
  const chars = [...text]
  const folded = chars.map(fold)
  const flat = folded.join('')
  // Posición en el texto plegado -> índice del carácter original.
  const owner: number[] = []
  folded.forEach((f, i) => {
    for (let k = 0; k < f.length; k++) owner.push(i)
  })
  const hits = new Array<boolean>(chars.length).fill(false)
  for (const term of terms) {
    let from = 0
    for (let at = flat.indexOf(term); at !== -1; at = flat.indexOf(term, from)) {
      from = at + term.length
      if (at > 0 && /[\p{L}\p{N}]/u.test(flat[at - 1])) continue
      for (let k = at; k < at + term.length; k++) hits[owner[k]] = true
    }
  }
  const parts: { text: string; hit: boolean }[] = []
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1]
    if (last && last.hit === hits[i]) last.text += c
    else parts.push({ text: c, hit: hits[i] })
  })
  return parts
}
