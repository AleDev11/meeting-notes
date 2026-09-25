import { app } from 'electron'
import { randomUUID } from 'crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import type { Folder, Meeting, MeetingSummary } from '../shared/types'

/**
 * Biblioteca en disco:
 *   library/folders.json
 *   library/meetings/<id>/meeting.json
 *   library/meetings/<id>/audio.webm
 */
export const libraryDir = (): string => join(app.getPath('userData'), 'library')
const meetingsDir = (): string => join(libraryDir(), 'meetings')
const meetingDir = (id: string): string => join(meetingsDir(), id)
const foldersFile = (): string => join(libraryDir(), 'folders.json')
export const audioPath = (id: string): string => join(meetingDir(id), 'audio.webm')

export function initStore(): void {
  mkdirSync(meetingsDir(), { recursive: true })
  if (!existsSync(foldersFile())) writeFileSync(foldersFile(), '[]')
}

// ---------- carpetas ----------

export function listFolders(): Folder[] {
  return JSON.parse(readFileSync(foldersFile(), 'utf8'))
}

function writeFolders(folders: Folder[]): void {
  writeFileSync(foldersFile(), JSON.stringify(folders, null, 2))
}

export function createFolder(name: string, parentId: string | null): Folder {
  const folders = listFolders()
  const siblings = folders.filter((f) => f.parentId === parentId)
  const folder: Folder = { id: randomUUID(), name, parentId, order: siblings.length }
  writeFolders([...folders, folder])
  return folder
}

export function updateFolder(folder: Folder): void {
  writeFolders(listFolders().map((f) => (f.id === folder.id ? folder : f)))
}

/** Borra la carpeta y sus subcarpetas; las reuniones pasan a la carpeta padre. */
export function deleteFolder(id: string): void {
  const folders = listFolders()
  const target = folders.find((f) => f.id === id)
  if (!target) return
  const doomed = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
        doomed.add(f.id)
        grew = true
      }
    }
  }
  for (const m of listMeetings()) {
    if (m.folderId && doomed.has(m.folderId)) {
      const full = getMeeting(m.id)
      if (full) saveMeeting({ ...full, folderId: target.parentId })
    }
  }
  writeFolders(folders.filter((f) => !doomed.has(f.id)))
}

export function reorderFolders(updates: Pick<Folder, 'id' | 'parentId' | 'order'>[]): void {
  const byId = new Map(updates.map((u) => [u.id, u]))
  writeFolders(listFolders().map((f) => ({ ...f, ...byId.get(f.id) })))
}

// ---------- reuniones ----------

export function listMeetings(): MeetingSummary[] {
  if (!existsSync(meetingsDir())) return []
  const out: MeetingSummary[] = []
  for (const id of readdirSync(meetingsDir())) {
    const m = getMeeting(id)
    if (m) {
      out.push({
        id: m.id,
        title: m.title,
        folderId: m.folderId,
        order: m.order,
        createdAt: m.createdAt,
        status: m.status,
        durationSec: m.durationSec
      })
    }
  }
  return out
}

export function getMeeting(id: string): Meeting | null {
  const f = join(meetingDir(id), 'meeting.json')
  if (!existsSync(f)) return null
  const m = JSON.parse(readFileSync(f, 'utf8')) as Meeting
  // Reuniones guardadas con versiones anteriores.
  if (!Array.isArray(m.transcript)) m.transcript = []
  if (!m.speakers || typeof Object.values(m.speakers)[0] === 'string') m.speakers = {}
  m.transcript = m.transcript.filter((s) => s.speakerId && s.id)
  return m
}

export function saveMeeting(m: Meeting): void {
  mkdirSync(meetingDir(m.id), { recursive: true })
  writeFileSync(join(meetingDir(m.id), 'meeting.json'), JSON.stringify(m, null, 2))
}

export function createMeeting(folderId: string | null): Meeting {
  const now = new Date()
  const siblings = listMeetings().filter((m) => m.folderId === folderId)
  const m: Meeting = {
    id: randomUUID(),
    title: `Reunión ${now.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`,
    folderId,
    order: siblings.length,
    createdAt: now.toISOString(),
    durationSec: 0,
    transcript: [],
    speakers: {},
    finalized: false,
    sections: [{ id: randomUUID(), title: 'Notas generales', content: '', order: 0 }],
    summary: null,
    summaryPromptId: null,
    hasAudio: false,
    status: 'idle'
  }
  saveMeeting(m)
  return m
}

export function deleteMeeting(id: string): void {
  rmSync(meetingDir(id), { recursive: true, force: true })
}

export function reorderMeetings(updates: Pick<Meeting, 'id' | 'folderId' | 'order'>[]): void {
  for (const u of updates) {
    const m = getMeeting(u.id)
    if (m) saveMeeting({ ...m, folderId: u.folderId, order: u.order })
  }
}

export function resetAudio(id: string): void {
  mkdirSync(meetingDir(id), { recursive: true })
  writeFileSync(audioPath(id), Buffer.alloc(0))
}

export function appendAudio(id: string, chunk: Uint8Array): void {
  appendFileSync(audioPath(id), chunk)
}
