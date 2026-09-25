import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'
import { IMAGE_TYPES } from '../shared/types'
import { attachmentPath, audioTrack } from './store'

/**
 * meeting-audio://<id-reunión>/ sirve la grabación de una reunión al reproductor,
 * meeting-audio://<id-reunión>/screen, la grabación de pantalla, y
 * meeting-audio://<id-reunión>/attachments/<fichero>, las imágenes de las notas.
 * Admite peticiones parciales (Range) para poder saltar a cualquier punto.
 */
const SCHEME = 'meeting-audio'

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

/** Fichero y tipo que corresponden a la URL pedida, o null si no existe o no es válida. */
function resolve(url: URL): { file: string; type: string } | null {
  const id = url.hostname
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const attachment = /^\/attachments\/([^/]+)$/.exec(url.pathname)
  if (attachment) {
    const file = attachmentPath(id, attachment[1])
    if (!file || !existsSync(file)) return null
    return { file, type: IMAGE_TYPES[extname(file).slice(1)] }
  }
  const screen = url.pathname === '/screen'
  const file = audioTrack(id, screen ? 'screen' : 'mix')
  return file ? { file, type: screen ? 'video/mp4' : 'audio/webm' } : null
}

export function handleMediaRequests(): void {
  protocol.handle(SCHEME, (req) => {
    const found = resolve(new URL(req.url))
    if (!found) return new Response(null, { status: 404 })
    const { file, type } = found

    const size = statSync(file).size
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' }
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('Range') ?? '')
    if (!range) {
      const body = Readable.toWeb(createReadStream(file)) as ReadableStream
      return new Response(body, { headers: { ...headers, 'Content-Length': String(size) } })
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` }
    })
  })
}
