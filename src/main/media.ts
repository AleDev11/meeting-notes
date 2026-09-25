import { protocol } from 'electron'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { audioTrack } from './store'

/**
 * meeting-audio://<id-reunión>/ sirve la grabación de una reunión al reproductor y
 * meeting-audio://<id-reunión>/screen, la grabación de pantalla.
 * Admite peticiones parciales (Range) para poder saltar a cualquier punto.
 */
const SCHEME = 'meeting-audio'

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

export function handleMediaRequests(): void {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url)
    const id = url.hostname
    const screen = url.pathname === '/screen'
    const file = /^[0-9a-f-]{36}$/.test(id) ? audioTrack(id, screen ? 'screen' : 'mix') : null
    if (!file) return new Response(null, { status: 404 })

    const size = statSync(file).size
    const headers = { 'Content-Type': screen ? 'video/mp4' : 'audio/webm', 'Accept-Ranges': 'bytes' }
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
