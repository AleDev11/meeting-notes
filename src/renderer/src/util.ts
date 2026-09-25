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

export function errorMessage(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )
}
