import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Meeting, MeetingSummary, SearchResult } from '../shared/types'

/**
 * Índice de la biblioteca en SQLite (library/index.db).
 *
 * Los meeting.json siguen siendo la fuente de verdad; el índice se deriva de ellos y
 * se puede borrar sin perder nada. Sirve para listar la biblioteca sin leer cada
 * reunión entera y para buscar en títulos, transcripciones, notas y actas (FTS5,
 * sin distinguir mayúsculas ni tildes).
 */
let db: DatabaseSync
let q: Record<string, StatementSync>

export function openIndex(file: string): void {
  db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      folderId TEXT,
      ord INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      status TEXT NOT NULL,
      durationSec INTEGER NOT NULL,
      mtime REAL NOT NULL,
      indexed INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
      id UNINDEXED, title, transcript, notes, summary,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `)
  q = {
    upsert: db.prepare(`INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, folderId = excluded.folderId, ord = excluded.ord,
      createdAt = excluded.createdAt, status = excluded.status, durationSec = excluded.durationSec,
      mtime = excluded.mtime, indexed = excluded.indexed`),
    removeText: db.prepare('DELETE FROM search WHERE id = ?'),
    insertText: db.prepare('INSERT INTO search VALUES (?, ?, ?, ?, ?)'),
    remove: db.prepare('DELETE FROM meetings WHERE id = ?'),
    list: db.prepare('SELECT id, title, folderId, ord, createdAt, status, durationSec FROM meetings'),
    mtimes: db.prepare('SELECT id, mtime, indexed FROM meetings'),
    search: db.prepare(`
      SELECT s.id, m.title, m.createdAt, m.folderId,
        snippet(search, -1, char(1), char(2), '…', 14) AS snippet
      FROM search s JOIN meetings m ON m.id = s.id
      WHERE search MATCH ?
      ORDER BY bm25(search, 0, 10, 1, 2, 2)
      LIMIT 50`)
  }
}

const transaction = (fn: () => void): void => {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/**
 * Guarda los datos de la reunión en el índice. Mientras se graba solo se actualizan
 * los metadatos: el texto se indexa al terminar, para no reindexar en cada frase.
 */
export function indexMeeting(m: Meeting, mtime: number): void {
  const withText = m.status !== 'recording'
  transaction(() => {
    q.upsert.run(m.id, m.title, m.folderId, m.order, m.createdAt, m.status, m.durationSec, mtime, withText ? 1 : 0)
    if (!withText) return
    q.removeText.run(m.id)
    q.insertText.run(
      m.id,
      m.title,
      m.transcript.map((s) => s.text).join('\n'),
      m.sections.map((s) => `${s.title}\n${s.content}`).join('\n'),
      m.summary ?? ''
    )
  })
}

export function removeFromIndex(id: string): void {
  transaction(() => {
    q.remove.run(id)
    q.removeText.run(id)
  })
}

/**
 * Pone el índice al día con las reuniones en disco: indexa las nuevas o modificadas
 * (por fecha de modificación) y quita las que ya no existen. La primera vez indexa todo.
 */
export function syncIndex(onDisk: Map<string, number>, read: (id: string) => Meeting | null): void {
  const known = new Map(
    (q.mtimes.all() as { id: string; mtime: number; indexed: number }[]).map((r) => [r.id, r])
  )
  for (const [id] of known) if (!onDisk.has(id)) removeFromIndex(id)
  for (const [id, mtime] of onDisk) {
    const row = known.get(id)
    if (row && row.mtime === mtime && row.indexed) continue
    const m = read(id)
    if (m) indexMeeting(m, mtime)
  }
}

export function listIndexed(): MeetingSummary[] {
  return (q.list.all() as (Omit<MeetingSummary, 'order'> & { ord: number })[]).map(({ ord, ...m }) => ({
    ...m,
    order: ord
  }))
}

/** Convierte lo que escribe el usuario en una consulta FTS5: todas las palabras, como prefijo. */
function toQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean)
  return terms.length ? terms.map((t) => `"${t}"*`).join(' ') : null
}

export function searchIndex(text: string): SearchResult[] {
  const query = toQuery(text)
  if (!query) return []
  return (q.search.all(query) as unknown as SearchResult[]).map((r) => ({
    ...r,
    // Marcas \u0001 y \u0002 alrededor de cada coincidencia; el renderer las resalta.
    snippet: r.snippet.replace(/\s+/g, ' ')
  }))
}
