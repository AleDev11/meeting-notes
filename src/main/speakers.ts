import { randomUUID } from 'crypto'
import { ME, OTHERS, type Meeting, type Speaker, type TranscriptSegment } from '../shared/types'
import type { RawSegment } from './transcription/types'

export function nextIndex(speakers: Record<string, Speaker>): number {
  const used = Object.values(speakers)
    .filter((s) => s.id !== ME && s.id !== OTHERS)
    .map((s) => s.index)
  return used.length ? Math.max(...used) + 1 : 1
}

export function ensureSpeaker(m: Meeting, id: string): void {
  if (m.speakers[id]) return
  const index = id === ME || id === OTHERS ? 0 : nextIndex(m.speakers)
  m.speakers[id] = { id, name: '', index }
}

export function newSpeakerId(): string {
  return `p-${randomUUID().slice(0, 8)}`
}

/** Elimina hablantes que ya no tienen ningún fragmento (salvo que tengan nombre). */
export function pruneSpeakers(m: Meeting): void {
  const used = new Set(m.transcript.map((s) => s.speakerId))
  for (const id of Object.keys(m.speakers)) {
    if (!used.has(id) && !m.speakers[id].name) delete m.speakers[id]
  }
}

export function renameSpeaker(m: Meeting, id: string, name: string): void {
  ensureSpeaker(m, id)
  m.speakers[id] = { ...m.speakers[id], name }
}

/** "Persona 3 es en realidad Persona 1": mueve todos sus fragmentos. */
export function mergeSpeakers(m: Meeting, fromId: string, intoId: string): void {
  if (fromId === intoId) return
  ensureSpeaker(m, intoId)
  const from = m.speakers[fromId]
  if (from?.name && !m.speakers[intoId].name) m.speakers[intoId].name = from.name
  m.transcript = m.transcript.map((s) => (s.speakerId === fromId ? { ...s, speakerId: intoId } : s))
  delete m.speakers[fromId]
}

/** Cambia el hablante de unos fragmentos. speakerId = 'new' crea una persona nueva. */
export function reassignSegments(m: Meeting, segmentIds: string[], speakerId: string): void {
  const target = speakerId === 'new' ? newSpeakerId() : speakerId
  ensureSpeaker(m, target)
  const ids = new Set(segmentIds)
  m.transcript = m.transcript.map((s) => (ids.has(s.id) ? { ...s, speakerId: target } : s))
  pruneSpeakers(m)
}

type Span = { start: number; end: number }
type Said = Span & { text: string }

const overlap = (a: Span, b: Span): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/**
 * ¿Es este fragmento del micrófono el eco de lo que sonaba por los altavoces?
 * Sin auriculares, el micrófono recoge a los demás participantes y sus frases
 * aparecerían duplicadas como tuyas. Se considera eco si casi todas sus palabras
 * las estaba diciendo otra persona en ese mismo momento.
 */
export function isEcho(mic: Said, others: Said[]): boolean {
  const mine = words(mic.text)
  if (!mine.length) return false
  const near = others.filter((o) => o.end > mic.start - 2 && o.start < mic.end + 2)
  if (!near.length) return false
  const pool = new Set(near.flatMap((o) => words(o.text)))
  const hits = mine.filter((w) => pool.has(w)).length
  if (mine.length >= 3) return hits / mine.length >= 0.6
  // En frases muy cortas ("vale", "sí") exige coincidencia total y en el mismo instante.
  const dur = Math.max(0.3, mic.end - mic.start)
  return hits === mine.length && near.some((o) => overlap(o, mic) / dur >= 0.5)
}

/**
 * Une la transcripción de tu micrófono (siempre tú) con la del audio del sistema
 * (el resto de personas, ya separadas), quitando el eco de los altavoces.
 */
export function mergeTracks(mic: RawSegment[], system: RawSegment[]): RawSegment[] {
  const mine = mic.filter((s) => !isEcho(s, system)).map((s) => ({ ...s, speaker: ME }))
  return [...mine, ...system].sort((a, b) => a.start - b.start)
}

/**
 * Sustituye la transcripción en vivo por la final (más precisa) conservando la
 * identidad de los hablantes: cada hablante de la pasada final se empareja con
 * el hablante en vivo con el que más tiempo coincide, así los nombres que el
 * usuario asignó durante la reunión se mantienen.
 */
export function applyFinalTranscript(m: Meeting, final: RawSegment[]): void {
  const live = m.transcript
  // Con las pistas separadas tu voz ya viene identificada y no entra en el emparejamiento.
  const hasMe = final.some((s) => s.speaker === ME)
  const rawKeys = [...new Set(final.map((s) => s.speaker ?? '?'))].filter((k) => !(hasMe && k === ME))
  const liveIds = [...new Set(live.map((s) => s.speakerId))].filter((id) => id !== OTHERS && !(hasMe && id === ME))

  const talkTime = new Map<string, number>()
  const scores: { raw: string; live: string; score: number }[] = []
  for (const raw of rawKeys) {
    const mine = final.filter((s) => (s.speaker ?? '?') === raw)
    talkTime.set(
      raw,
      mine.reduce((t, s) => t + (s.end - s.start), 0)
    )
    for (const id of liveIds) {
      let score = 0
      for (const f of mine) {
        for (const l of live) if (l.speakerId === id) score += overlap(f, l)
      }
      if (score > 0) scores.push({ raw, live: id, score })
    }
  }

  // Emparejamiento voraz 1:1 por mayor solapamiento.
  const mapping = new Map<string, string>()
  const takenLive = new Set<string>()
  if (hasMe) {
    mapping.set(ME, ME)
    takenLive.add(ME)
  }
  for (const s of scores.sort((a, b) => b.score - a.score)) {
    if (mapping.has(s.raw) || takenLive.has(s.live)) continue
    if (s.score < 0.25 * (talkTime.get(s.raw) ?? 0)) continue
    mapping.set(s.raw, s.live)
    takenLive.add(s.live)
  }

  const oldSpeakers = m.speakers
  const speakers: Record<string, Speaker> = {}
  m.speakers = speakers
  for (const id of takenLive) speakers[id] = oldSpeakers[id] ?? { id, name: '', index: 0 }
  // Los hablantes con nombre que no se han emparejado se conservan para poder reasignarlos.
  for (const s of Object.values(oldSpeakers)) {
    if (s.name && !speakers[s.id] && s.id !== OTHERS) speakers[s.id] = s
  }
  // Orden de aparición para numerar a las personas nuevas.
  const order = [...rawKeys].sort(
    (a, b) =>
      Math.min(...final.filter((s) => (s.speaker ?? '?') === a).map((s) => s.start)) -
      Math.min(...final.filter((s) => (s.speaker ?? '?') === b).map((s) => s.start))
  )
  for (const raw of order) {
    if (mapping.has(raw)) continue
    const id = newSpeakerId()
    mapping.set(raw, id)
    speakers[id] = { id, name: '', index: nextIndex(speakers) }
  }

  m.transcript = final.map(
    (s): TranscriptSegment => ({
      id: randomUUID(),
      speakerId: mapping.get(s.speaker ?? '?')!,
      text: s.text,
      start: s.start,
      end: s.end,
      source: 'final',
      ...(s.lang && { lang: s.lang })
    })
  )
  m.finalized = true
}
