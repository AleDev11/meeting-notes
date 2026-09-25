import type { GlossaryEntry } from './types'

/** Término sin espacios de más. */
export const cleanTerm = (t: string): string => t.trim().replace(/\s+/g, ' ')

/** Clave para comparar términos sin distinguir mayúsculas. */
export const termKey = (t: string): string => cleanTerm(t).toLowerCase()

export function findEntry(list: GlossaryEntry[], term: string): GlossaryEntry | undefined {
  const k = termKey(term)
  return k ? list.find((e) => termKey(e.term) === k) : undefined
}

/** Quita vacíos y duplicados; si un término se repite, conserva el significado que haya. */
export function normalizeGlossary(list: GlossaryEntry[]): GlossaryEntry[] {
  const out: GlossaryEntry[] = []
  const byKey = new Map<string, GlossaryEntry>()
  for (const e of list) {
    const term = cleanTerm(e?.term ?? '')
    if (!term) continue
    const meaning = (e.meaning ?? '').trim()
    const prev = byKey.get(termKey(term))
    if (prev) {
      if (!prev.meaning && meaning) prev.meaning = meaning
      continue
    }
    const entry = { term, meaning }
    byKey.set(termKey(term), entry)
    out.push(entry)
  }
  return out
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const WORD = /[\p{L}\p{N}_]+/gu
/** Términos hechos solo de palabras: se buscan por palabras, no con expresiones. */
const SIMPLE = /^[\p{L}\p{N}_]+( [\p{L}\p{N}_]+)*$/u

export interface TermMatch {
  start: number
  end: number
  key: string
}

export type TermMatcher = (text: string) => TermMatch[]

/**
 * Busca los términos como palabras completas, sin distinguir mayúsculas.
 * Recorre el texto palabra a palabra, así que va rápido aunque haya cientos de términos.
 */
export function termMatcher(terms: string[]): TermMatcher | null {
  const simple = new Set<string>()
  const complex: { key: string; re: RegExp }[] = []
  let maxWords = 1
  for (const key of new Set(terms.map(termKey).filter(Boolean))) {
    if (SIMPLE.test(key)) {
      simple.add(key)
      maxWords = Math.max(maxWords, key.split(' ').length)
    } else {
      // "C++", "Node.js", "CI/CD"…
      const body = escape(key).replace(/ /g, '\\s+')
      complex.push({ key, re: new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu') })
    }
  }
  if (!simple.size && !complex.length) return null

  return (text) => {
    const out: TermMatch[] = []
    if (simple.size) {
      const words: { w: string; start: number; end: number; spaced: boolean }[] = []
      let prevEnd = -1
      for (const m of text.matchAll(WORD)) {
        // Las palabras de un término solo pueden ir separadas por espacios.
        const spaced = maxWords > 1 && prevEnd >= 0 && !text.slice(prevEnd, m.index).trim()
        words.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length, spaced })
        prevEnd = m.index + m[0].length
      }
      for (let i = 0; i < words.length; i++) {
        let key = ''
        let hit = ''
        let len = 0
        for (let n = 0; n < maxWords && i + n < words.length; n++) {
          if (n > 0 && !words[i + n].spaced) break
          key = n ? `${key} ${words[i + n].w}` : words[i].w
          if (simple.has(key)) {
            hit = key
            len = n + 1
          }
        }
        if (hit) {
          out.push({ start: words[i].start, end: words[i + len - 1].end, key: hit })
          i += len - 1
        }
      }
    }
    for (const { key, re } of complex) {
      re.lastIndex = 0
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const start = m.index
        const end = start + m[0].length
        if (!out.some((x) => x.start < end && start < x.end)) out.push({ start, end, key })
      }
    }
    return complex.length ? out.sort((a, b) => a.start - b.start) : out
  }
}

/** Con pocos términos se envían todos; con muchos, solo los que aparecen en el texto. */
const SEND_ALL = 40
const MAX_ENTRIES = 150

export function relevantGlossary(list: GlossaryEntry[], text: string): GlossaryEntry[] {
  const withMeaning = list.filter((e) => cleanTerm(e.term) && e.meaning.trim())
  if (withMeaning.length <= SEND_ALL) return withMeaning
  const found = new Set(termMatcher(withMeaning.map((e) => e.term))?.(text).map((m) => m.key))
  return withMeaning.filter((e) => found.has(termKey(e.term))).slice(0, MAX_ENTRIES)
}

/** Bloque de contexto para la IA con las jergas que tienen significado. */
export function glossaryBlock(list: GlossaryEntry[] | undefined, text: string): string {
  const entries = relevantGlossary(list ?? [], text)
  if (!entries.length) return ''
  const lines = entries.map((e) => `- ${cleanTerm(e.term)}: ${e.meaning.trim().replace(/\s+/g, ' ')}`)
  return [
    '<glosario>',
    'Jerga y vocabulario propios del usuario. Cuando aparezca uno de estos términos (en mayúsculas o minúsculas), interprétalo con el significado indicado: no es una errata ni una palabra cortada.',
    ...lines,
    '</glosario>'
  ].join('\n')
}
