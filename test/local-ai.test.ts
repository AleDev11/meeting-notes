/*
 * Pruebas del gestor de IA local contra un servidor HTTP que imita a Ollama
 * (/api/version, /api/tags y /api/pull en streaming). La instalación se sustituye por
 * dobles de prueba: aquí no se descarga ni se instala nada de verdad.
 *   bun test
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LocalAiState } from '../src/shared/types'
import { explainPullError, LocalAiManager, pickModel, SpeedMeter, type LocalAiDeps } from '../src/main/local-ai'

const GIB = 1024 ** 3

// ---------------- servidor simulado ----------------

interface Mock {
  running: boolean
  models: string[]
  pull: 'ok' | 'error' | 'cut' | 'slow'
  installerBytes: number
  pulls: number
}

const mock: Mock = { running: true, models: [], pull: 'ok', installerBytes: 256 * 1024, pulls: 0 }
let server: Server
let base = ''

const LAYERS = [
  { digest: 'sha256:aaa', total: 6_000_000 },
  { digest: 'sha256:bbb', total: 400_000 },
  { digest: 'sha256:ccc', total: 1_000 }
]

function handler(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? ''
  if (url === '/OllamaSetup.exe') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(mock.installerBytes) })
    if (req.method === 'HEAD') return void res.end()
    const chunk = Buffer.alloc(16 * 1024, 7)
    let sent = 0
    const tick = (): void => {
      if (sent >= mock.installerBytes) return void res.end()
      const n = Math.min(chunk.length, mock.installerBytes - sent)
      sent += n
      res.write(chunk.subarray(0, n))
      setTimeout(tick, 2)
    }
    return tick()
  }
  if (!mock.running) {
    req.socket.destroy()
    return
  }
  if (url === '/api/version') return void res.end(JSON.stringify({ version: '0.34.4' }))
  if (url === '/api/tags') return void res.end(JSON.stringify({ models: mock.models.map((name) => ({ name, size: 1 })) }))
  if (url === '/api/pull' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      mock.pulls++
      const { model } = JSON.parse(body) as { model: string }
      if (mock.pull === 'error' && model.includes('missing')) {
        res.writeHead(500)
        return void res.end(JSON.stringify({ error: 'pull model manifest: file does not exist' }))
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      const line = (o: object): boolean => res.write(JSON.stringify(o) + '\n')
      line({ status: 'pulling manifest' })
      for (const l of LAYERS) {
        for (let done = 0; done <= l.total; done += l.total / 4) {
          if (res.destroyed) return
          line({ status: `pulling ${l.digest.slice(7)}`, digest: l.digest, total: l.total, completed: done })
          await new Promise((r) => setTimeout(r, mock.pull === 'slow' ? 60 : 1))
        }
        if (mock.pull === 'cut') return void res.destroy()
      }
      if (mock.pull === 'error') {
        line({ error: 'max retries exceeded: dial tcp: lookup registry.ollama.ai: no such host' })
        return void res.end()
      }
      line({ status: 'verifying sha256 digest' })
      line({ status: 'writing manifest' })
      line({ status: 'success' })
      mock.models.push(model)
      res.end()
    })
    return
  }
  res.writeHead(404)
  res.end()
}

beforeAll(async () => {
  server = createServer(handler)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})
afterAll(() => server.close())

// ---------------- gestor con dobles ----------------

interface Harness {
  m: LocalAiManager
  states: LocalAiState[]
  configured: { url: string; model: string }[]
  calls: string[]
  tmp: string
}

function harness(over: Partial<LocalAiDeps> = {}, opts: { installed?: boolean } = {}): Harness {
  const tmp = mkdtempSync(join(tmpdir(), 'local-ai-test-'))
  const states: LocalAiState[] = []
  const configured: { url: string; model: string }[] = []
  const calls: string[] = []
  let installed = opts.installed ?? false
  const deps: LocalAiDeps = {
    fetch: globalThis.fetch,
    platform: 'win32',
    tempDir: () => tmp,
    installerUrl: base + '/OllamaSetup.exe',
    findInstall: () => (installed ? 'C:\\fake\\ollama.exe' : null),
    verify: async (file) => {
      calls.push('verify:' + file)
      return { valid: true, status: 'Valid', subject: 'CN=Ollama Inc., O=Ollama Inc., C=CA' }
    },
    runInstaller: async () => {
      calls.push('install')
      installed = true
      return 0
    },
    launch: () => {
      calls.push('launch')
      mock.running = true
    },
    totalMem: () => 32 * GIB,
    freeBytes: async () => 500e9,
    modelsDir: () => tmp,
    modelBytes: async () => 0,
    loadConfig: () => ({ url: base }),
    configure: (p) => configured.push(p),
    persist: () => {},
    emit: (s) => states.push(s),
    startTimeoutMs: 3000,
    pollMs: 50,
    ...over
  }
  return { m: new LocalAiManager(deps), states, configured, calls, tmp }
}

const reset = (p: Partial<Mock> = {}): void => void Object.assign(mock, { running: true, models: [], pull: 'ok', pulls: 0 }, p)

describe('pickModel', () => {
  test('elige por RAM', () => {
    expect(pickModel(32 * GIB).model).toBe('qwen3.5:9b')
    expect(pickModel(15.7 * GIB).model).toBe('qwen3.5:9b')
    expect(pickModel(7.8 * GIB).model).toBe('qwen3.5:4b')
    expect(pickModel(12 * GIB).model).toBe('qwen3.5:4b')
    const small = pickModel(4 * GIB)
    expect(small.model).toBe('qwen3.5:2b')
    expect(small.note).toContain('4 GB')
  })
})

describe('SpeedMeter', () => {
  test('mide bytes por segundo', () => {
    let t = 1000
    const s = new SpeedMeter(() => t)
    s.update(0)
    t += 1000
    expect(s.update(10_000_000)).toBe(10_000_000)
  })
})

describe('explainPullError', () => {
  test('clasifica errores de Ollama', () => {
    expect(explainPullError('dial tcp: lookup registry.ollama.ai: no such host', 'x').code).toBe('offline')
    expect(explainPullError('pull model manifest: file does not exist', 'x').code).toBe('pull')
    expect(explainPullError('write: There is not enough space on the disk', 'x').code).toBe('disk')
  })
})

describe('LocalAiManager', () => {
  test('detecta Ollama en marcha y sus modelos', async () => {
    reset({ models: ['qwen3.5:4b'] })
    const { m } = harness()
    const d = await m.detect()
    expect(d.running).toBe(true)
    expect(d.installed).toBe(true)
    expect(d.version).toBe('0.34.4')
    expect(d.models).toEqual(['qwen3.5:4b'])
    expect(d.recommended).toBe('qwen3.5:9b')
  })

  test('con Ollama en marcha solo descarga el modelo y configura', async () => {
    reset()
    const h = harness()
    await h.m.start()
    const st = h.m.getState()
    expect(st.status).toBe('done')
    expect(st.skipped).toEqual(['download', 'install', 'start'])
    expect(h.calls).toEqual([])
    expect(h.configured).toEqual([{ url: base, model: 'qwen3.5:9b' }])
    // Progreso agregado de todas las capas, que no retrocede.
    const prog = h.states.filter((s) => s.stage === 'model' && s.progress?.total).map((s) => s.progress!)
    expect(prog.length).toBeGreaterThan(0)
    const last = prog[prog.length - 1]
    expect(last.done).toBe(last.total)
    expect(last.total).toBe(LAYERS.reduce((a, l) => a + l.total, 0))
  })

  test('modelo ya descargado: no vuelve a descargarlo', async () => {
    reset({ models: ['qwen3.5:9b'] })
    const h = harness()
    await h.m.start()
    expect(h.m.getState().status).toBe('done')
    expect(h.m.getState().skipped).toContain('model')
    expect(mock.pulls).toBe(0)
  })

  test('sin Ollama: descarga, verifica, instala, arranca y descarga el modelo', async () => {
    reset({ running: false })
    const h = harness({
      runInstaller: async () => {
        h.calls.push('install')
        installed = true
        // Como el instalador real, deja Ollama abierto al terminar.
        mock.running = true
        return 0
      },
      findInstall: () => (installed ? 'C:\\fake\\ollama.exe' : null)
    })
    let installed = false
    await h.m.start()
    const st = h.m.getState()
    expect(st.error).toBeUndefined()
    expect(st.status).toBe('done')
    expect(h.calls[0]).toMatch(/^verify:.*OllamaSetup\.exe$/)
    expect(h.calls[1]).toBe('install')
    expect(st.skipped).toEqual([])
    const dl = h.states.filter((s) => s.stage === 'download' && s.progress?.done)
    expect(dl.length).toBeGreaterThan(0)
    expect(dl[dl.length - 1].progress!.total).toBe(mock.installerBytes)
    // El instalador se borra después.
    expect(readdirSync(h.tmp)).toEqual([])
    rmSync(h.tmp, { recursive: true, force: true })
  })

  test('instalado pero parado: lo arranca', async () => {
    reset({ running: false, models: ['qwen3.5:9b'] })
    const h = harness({}, { installed: true })
    await h.m.start()
    expect(h.m.getState().status).toBe('done')
    expect(h.calls).toEqual(['launch'])
    expect(h.m.getState().skipped).toEqual(['download', 'install', 'model'])
  })

  test('firma no válida: no ejecuta el instalador', async () => {
    reset({ running: false })
    const h = harness({ verify: async () => ({ valid: false, status: 'HashMismatch', subject: '' }) })
    await h.m.start()
    const st = h.m.getState()
    expect(st.status).toBe('error')
    expect(st.error?.code).toBe('signature')
    expect(st.error?.stage).toBe('install')
    expect(h.calls).not.toContain('install')
    expect(readdirSync(h.tmp)).toEqual([])
  })

  test('firmado por otro: se rechaza', async () => {
    reset({ running: false })
    const h = harness({ verify: async () => ({ valid: false, status: 'Valid', subject: 'CN=Evil, O=Not Ollama Inc.' }) })
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('signature')
    expect(h.m.getState().error?.message).toContain('Not Ollama')
  })

  test('el instalador falla', async () => {
    reset({ running: false })
    const h = harness({ runInstaller: async () => 5 })
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('installer')
  })

  test('Ollama no arranca: error de inicio', async () => {
    reset({ running: false })
    const h = harness({ launch: () => {}, startTimeoutMs: 400 }, { installed: true })
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('start')
  })

  test('sin espacio para el modelo', async () => {
    reset()
    const h = harness({ freeBytes: async () => 2e9 })
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('disk')
    expect(mock.pulls).toBe(0)
  })

  test('sin espacio para instalar', async () => {
    reset({ running: false, installerBytes: 256 * 1024 })
    const h = harness({ freeBytes: async () => 100 })
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('disk')
    expect(h.m.getState().error?.stage).toBe('download')
  })

  test('sin internet al descargar el instalador', async () => {
    reset({ running: false })
    const h = harness({ installerUrl: 'http://no-existe.invalid/OllamaSetup.exe' })
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('offline')
  })

  test('error de Ollama durante la descarga del modelo', async () => {
    reset({ pull: 'error' })
    const h = harness()
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('offline')
    await h.m.start({ model: 'missing:1b' })
    expect(h.m.getState().error?.code).toBe('pull')
  })

  test('descarga del modelo cortada', async () => {
    reset({ pull: 'cut' })
    const h = harness()
    await h.m.start()
    expect(h.m.getState().error?.code).toBe('pull')
    // Reintentar retoma y termina.
    mock.pull = 'ok'
    await h.m.start()
    expect(h.m.getState().status).toBe('done')
  })

  test('cancelar la descarga del modelo', async () => {
    reset({ pull: 'slow' })
    const h = harness()
    const run = h.m.start()
    await new Promise((r) => setTimeout(r, 200))
    expect(h.m.busy()).toBe(true)
    h.m.cancel()
    await run
    const st = h.m.getState()
    expect(st.status).toBe('idle')
    expect(st.cancelled).toBe(true)
    expect(h.configured).toEqual([])
  })

  test('cancelar la descarga del instalador borra el fichero', async () => {
    reset({ running: false, installerBytes: 20 * 1024 * 1024 })
    const h = harness()
    const run = h.m.start()
    await new Promise((r) => setTimeout(r, 150))
    h.m.cancel()
    await run
    expect(h.m.getState().cancelled).toBe(true)
    expect(h.calls).toEqual([])
    expect(readdirSync(h.tmp)).toEqual([])
    mock.installerBytes = 256 * 1024
  })
})
