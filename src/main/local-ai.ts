/*
 * IA local con un clic: instala Ollama si falta, lo arranca, descarga el modelo Qwen 3.5
 * adecuado para el equipo y deja la app configurada para usarlo.
 *
 * Todo ocurre en el proceso principal para que siga aunque el usuario cambie de pantalla;
 * el estado se difunde a las ventanas con `emit`. Las operaciones con el sistema (descargar,
 * verificar la firma, ejecutar el instalador, arrancar Ollama) llegan como dependencias para
 * poder probar el flujo sin instalar nada.
 */
import { execFile, spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, promises as fsp, writeFileSync } from 'fs'
import { homedir, tmpdir, totalmem } from 'os'
import { delimiter, dirname, join, parse as parsePath } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import {
  DEFAULT_OLLAMA_URL,
  LOCAL_MODELS,
  OLLAMA_INSTALLER_URL,
  type LocalAiDetection,
  type LocalAiErrorCode,
  type LocalAiProgress,
  type LocalAiStage,
  type LocalAiState
} from '../shared/types'
import { normalizeUrl } from './ollama'

const GB = 1e9
const GIB = 1024 ** 3

/** Organización que firma el instalador oficial (la misma comprobación que el install.ps1 de Ollama). */
export const OLLAMA_SIGNER = /(^|, )O=Ollama Inc\.(,|$)/
export const INSTALLER_ARGS = ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES']

/** Estados de Get-AuthenticodeSignature, explicados. */
const SIGNATURE_STATUS: Record<string, string> = {
  NotSigned: 'el fichero no está firmado o se ha modificado',
  HashMismatch: 'el fichero se ha modificado después de firmarlo',
  NotTrusted: 'el certificado no es de confianza',
  UnknownError: 'no es un instalador firmado',
  Incompatible: 'firma incompatible'
}

// ---------------- elección del modelo ----------------

/** Modelo según la RAM total: 16 GB → 9B, 8 GB → 4B, menos → 2B. Se deja margen porque Windows reserva algo. */
export function pickModel(totalBytes: number): { model: string; ramGb: number; note?: string } {
  const gib = totalBytes / GIB
  const ramGb = Math.round(gib)
  if (gib >= 15) return { model: 'qwen3.5:9b', ramGb }
  if (gib >= 7) return { model: 'qwen3.5:4b', ramGb }
  return {
    model: 'qwen3.5:2b',
    ramGb,
    note: `Tu equipo tiene ${ramGb} GB de RAM: se usa qwen3.5:2b, el más ligero que da resúmenes aceptables. Serán más sencillos que con un modelo mayor.`
  }
}

export const knownModelBytes = (model: string): number => LOCAL_MODELS.find((m) => m.name === model)?.bytes ?? 0

// ---------------- errores ----------------

export class LocalAiError extends Error {
  constructor(
    readonly code: LocalAiErrorCode,
    message: string
  ) {
    super(message)
  }
}

const OFFLINE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ENETDOWN', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'])

function netCode(err: unknown): string {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.cause?.code ?? e?.code ?? ''
}

const isAbort = (err: unknown): boolean => (err as Error)?.name === 'AbortError' || (err as Error)?.name === 'TimeoutError'

const OFFLINE_MSG = 'No hay conexión a internet (o no se llega al servidor de descarga). Comprueba la conexión y vuelve a intentarlo.'

const fmtGb = (bytes: number): string => `${(bytes / GB).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB`

/** Traduce los errores que devuelve Ollama al descargar un modelo. */
export function explainPullError(message: string, model: string): LocalAiError {
  if (/no such host|dial tcp|i\/o timeout|network is unreachable|connection refused|tls handshake|EOF/i.test(message)) {
    return new LocalAiError(
      'offline',
      'Ollama no consigue conectar con internet para descargar el modelo. Comprueba la conexión y pulsa Reintentar: continuará donde se quedó.'
    )
  }
  if (/no space|not enough space|disk full/i.test(message)) {
    return new LocalAiError('disk', `No queda espacio en el disco para el modelo ${model}. Libera espacio y vuelve a intentarlo.`)
  }
  if (/file does not exist|manifest unknown|not found/i.test(message)) {
    return new LocalAiError('pull', `El modelo ${model} no existe en Ollama. Elige otro en Opciones avanzadas.`)
  }
  return new LocalAiError('pull', `No se ha podido descargar el modelo ${model}: ${message}`)
}

// ---------------- medidor de velocidad ----------------

/** Velocidad suavizada (media móvil exponencial) a partir de los bytes acumulados. */
export class SpeedMeter {
  private lastT = 0
  private lastBytes = 0
  private rate = 0
  constructor(private readonly now: () => number = Date.now) {}

  update(bytes: number): number {
    const t = this.now()
    if (!this.lastT) {
      this.lastT = t
      this.lastBytes = bytes
      return 0
    }
    const dt = (t - this.lastT) / 1000
    if (dt < 0.25) return this.rate
    const inst = Math.max(0, bytes - this.lastBytes) / dt
    this.rate = this.rate ? this.rate * 0.7 + inst * 0.3 : inst
    this.lastT = t
    this.lastBytes = bytes
    return this.rate
  }
}

// ---------------- dependencias ----------------

export interface VerifyResult {
  valid: boolean
  status: string
  subject: string
}

export interface LocalAiDeps {
  fetch: typeof fetch
  platform: NodeJS.Platform
  /** Carpeta temporal donde se descarga el instalador. */
  tempDir: () => string
  installerUrl: string
  /** Ruta a ollama.exe si está instalado, o null. */
  findInstall: () => string | null
  verify: (file: string) => Promise<VerifyResult>
  /** Ejecuta el instalador en silencio y devuelve el código de salida. */
  runInstaller: (file: string) => Promise<number>
  /** Arranca Ollama (sin ventana) a partir de la ruta de ollama.exe. */
  launch: (exe: string) => void
  totalMem: () => number
  freeBytes: (dir: string) => Promise<number>
  /** Carpeta donde Ollama guarda los modelos. */
  modelsDir: () => string
  /** Tamaño real del modelo según el registro de Ollama (0 si no se sabe). */
  modelBytes: (model: string) => Promise<number>
  loadConfig: () => { url: string }
  /** Guarda proveedor, URL y modelo en la configuración. */
  configure: (p: { url: string; model: string }) => void
  /** Recuerda que hay una activación a medias para retomarla al abrir la app. */
  persist: (pending: { model: string } | null) => void
  emit: (s: LocalAiState) => void
  startTimeoutMs?: number
  pollMs?: number
  now?: () => number
}

// ---------------- descarga con progreso ----------------

export async function downloadFile(
  doFetch: typeof fetch,
  url: string,
  dest: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  beforeWrite?: (total: number) => Promise<void>
): Promise<number> {
  let res: Response
  try {
    res = await doFetch(url, { signal, redirect: 'follow' })
  } catch (err) {
    if (isAbort(err)) throw err
    // Sin respuesta del servidor: sin conexión, DNS o cortafuegos.
    throw new LocalAiError('offline', OFFLINE_MSG)
  }
  if (!res.ok || !res.body) {
    throw new LocalAiError('download', `No se ha podido descargar Ollama (el servidor respondió ${res.status}). Vuelve a intentarlo en unos minutos.`)
  }
  const total = Number(res.headers.get('content-length')) || 0
  if (beforeWrite) {
    try {
      await beforeWrite(total)
    } catch (err) {
      await res.body.cancel().catch(() => {})
      throw err
    }
  }
  let done = 0
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length
      onProgress(done, total)
      cb(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(dest), { signal })
  } catch (err) {
    if (isAbort(err) || signal.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
    if (/ENOSPC/.test(netCode(err)) || /ENOSPC/.test((err as Error).message)) {
      throw new LocalAiError('disk', 'No queda espacio en el disco para descargar Ollama. Libera espacio y vuelve a intentarlo.')
    }
    if (OFFLINE_CODES.has(netCode(err))) throw new LocalAiError('offline', `La descarga se ha cortado. ${OFFLINE_MSG}`)
    throw new LocalAiError('download', `La descarga de Ollama se ha interrumpido: ${(err as Error).message}`)
  }
  if (total && done !== total) {
    throw new LocalAiError('download', 'La descarga de Ollama ha llegado incompleta. Vuelve a intentarlo.')
  }
  return done
}

// ---------------- el gestor ----------------

const STAGES: LocalAiStage[] = ['download', 'install', 'start', 'model', 'done']
const isLocal = (url: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(normalizeUrl(url))

export class LocalAiManager {
  private state: LocalAiState
  private abort: AbortController | null = null
  private lastEmit = 0
  private emitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly d: LocalAiDeps) {
    this.state = { status: 'idle', stage: null, skipped: [], model: pickModel(d.totalMem()).model }
  }

  getState = (): LocalAiState => this.state
  busy = (): boolean => this.state.status === 'running'

  private set(patch: Partial<LocalAiState>, throttle = false): void {
    this.state = { ...this.state, ...patch }
    const now = Date.now()
    if (throttle && now - this.lastEmit < 150) {
      if (!this.emitTimer) this.emitTimer = setTimeout(() => this.flush(), 150)
      return
    }
    this.flush()
  }

  private flush(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
    this.lastEmit = Date.now()
    this.d.emit(this.state)
  }

  private async ping(url: string): Promise<string | null> {
    try {
      const res = await this.d.fetch(normalizeUrl(url) + '/api/version', { signal: AbortSignal.timeout(2500) })
      if (!res.ok) return null
      const data = (await res.json()) as { version?: string }
      return data.version ?? ''
    } catch {
      return null
    }
  }

  private async tags(url: string): Promise<string[]> {
    try {
      const res = await this.d.fetch(normalizeUrl(url) + '/api/tags', { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return []
      const data = (await res.json()) as { models?: { name: string }[] }
      return (data.models ?? []).map((m) => m.name)
    } catch {
      return []
    }
  }

  /** Qué hay en el equipo: si Ollama responde, si está instalado y qué modelos tiene. */
  async detect(): Promise<LocalAiDetection> {
    const configured = this.d.loadConfig().url || DEFAULT_OLLAMA_URL
    let url = normalizeUrl(configured)
    let version = await this.ping(url)
    if (version === null && !isLocal(url)) {
      const local = await this.ping(DEFAULT_OLLAMA_URL)
      if (local !== null) {
        url = normalizeUrl(DEFAULT_OLLAMA_URL)
        version = local
      }
    }
    const running = version !== null
    const installed = running || !!this.d.findInstall()
    const pick = pickModel(this.d.totalMem())
    let installerBytes: number | undefined
    if (!installed) {
      try {
        const res = await this.d.fetch(this.d.installerUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) })
        installerBytes = Number(res.headers.get('content-length')) || undefined
      } catch {
        /* sin conexión: se sabrá al descargar */
      }
    }
    return {
      running,
      installed,
      version: version ?? undefined,
      models: running ? await this.tags(url) : [],
      url,
      recommended: pick.model,
      ramGb: pick.ramGb,
      note: pick.note,
      installerBytes
    }
  }

  cancel(): void {
    // El instalador no se interrumpe a medias (dejaría Ollama roto): se cancela al terminar.
    this.abort?.abort()
  }

  /** Activa la IA local. Si ya está en marcha, no hace nada. */
  async start(opts: { model?: string } = {}): Promise<void> {
    if (this.busy()) return
    const pick = pickModel(this.d.totalMem())
    const model = opts.model || pick.model
    const abort = new AbortController()
    this.abort = abort
    const signal = abort.signal
    this.set({
      status: 'running',
      stage: null,
      skipped: [],
      model,
      modelNote: opts.model && opts.model !== pick.model ? undefined : pick.note,
      progress: undefined,
      detail: 'Comprobando tu equipo…',
      error: undefined,
      cancelled: false
    })
    this.d.persist({ model })
    let stage: LocalAiStage = 'download'
    let installer: string | null = null
    try {
      let url = normalizeUrl(this.d.loadConfig().url || DEFAULT_OLLAMA_URL)
      let running = (await this.ping(url)) !== null
      if (!running && !isLocal(url)) {
        // Un servidor remoto que no responde: se instala en este equipo.
        url = normalizeUrl(DEFAULT_OLLAMA_URL)
        running = (await this.ping(url)) !== null
      }
      const skipped: LocalAiStage[] = []
      if (running) skipped.push('download', 'install', 'start')
      else {
        let exe = this.d.findInstall()
        let justInstalled = false
        if (!exe) {
          if (this.d.platform !== 'win32') {
            throw new LocalAiError('unsupported', 'La instalación automática solo está disponible en Windows. Instala Ollama desde ollama.com y vuelve a intentarlo.')
          }
          stage = 'download'
          installer = await this.downloadInstaller(signal)
          stage = 'install'
          exe = await this.install(installer, signal)
          installer = null
          justInstalled = true
        } else skipped.push('download', 'install')
        this.set({ skipped: [...skipped] })
        stage = 'start'
        await this.startServer(url, exe, justInstalled, signal)
      }
      this.set({ skipped: [...skipped] })

      stage = 'model'
      const models = await this.tags(url)
      if (models.includes(model) || models.includes(`${model}:latest`)) skipped.push('model')
      else await this.pull(url, model, signal)
      this.set({ skipped: [...skipped] })

      this.d.configure({ url, model })
      this.d.persist(null)
      this.set({ status: 'done', stage: 'done', progress: undefined, detail: undefined })
    } catch (err) {
      if (installer) await fsp.rm(dirname(installer), { recursive: true, force: true }).catch(() => {})
      if (signal.aborted || isAbort(err)) {
        this.d.persist(null)
        this.set({ status: 'idle', stage: null, progress: undefined, detail: undefined, cancelled: true })
        return
      }
      const e =
        err instanceof LocalAiError
          ? err
          : new LocalAiError(stage === 'model' ? 'pull' : stage === 'start' ? 'start' : stage === 'install' ? 'installer' : 'download', (err as Error).message)
      this.d.persist(null)
      this.set({ status: 'error', stage, progress: undefined, detail: undefined, error: { stage, code: e.code, message: e.message } })
    } finally {
      if (this.abort === abort) this.abort = null
    }
  }

  private progress(meter: SpeedMeter, done: number, total: number): LocalAiProgress {
    return { done, total, bytesPerSec: meter.update(done) }
  }

  private async downloadInstaller(signal: AbortSignal): Promise<string> {
    this.set({ stage: 'download', detail: 'Descargando Ollama…', progress: { done: 0, total: 0, bytesPerSec: 0 } })
    const dir = join(this.d.tempDir(), `ollama-setup-${Date.now().toString(36)}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'OllamaSetup.exe')
    const meter = new SpeedMeter(this.d.now)
    let last = { done: 0, total: 0 }
    try {
      await downloadFile(
        this.d.fetch,
        this.d.installerUrl,
        file,
        signal,
        (done, total) => {
          last = { done, total }
          this.set({ progress: this.progress(meter, done, total) }, true)
        },
        async (total) => {
          // El instalador más lo que ocupa Ollama instalado (librerías de GPU incluidas).
          const need = (total || 1.6 * GB) * 3
          const free = await this.d.freeBytes(dir).catch(() => Infinity)
          if (free < need) {
            throw new LocalAiError('disk', `No hay espacio suficiente para instalar Ollama: hacen falta unos ${fmtGb(need)} libres en ${parsePath(dir).root} y hay ${fmtGb(free)}.`)
          }
        }
      )
      // Los avisos de progreso van espaciados: el último (100 %) se envía siempre.
      this.set({ progress: this.progress(meter, last.done, last.total) })
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    return file
  }

  private async install(file: string, signal: AbortSignal): Promise<string> {
    const dir = dirname(file)
    try {
      this.set({ stage: 'install', detail: 'Comprobando la firma digital del instalador…', progress: undefined })
      const sig = await this.d.verify(file)
      if (!sig.valid) {
        throw new LocalAiError(
          'signature',
          sig.status === 'Valid'
            ? `El instalador descargado no está firmado por Ollama (firmante: ${sig.subject || 'desconocido'}). No se ha ejecutado.`
            : `La firma digital del instalador no es válida (${SIGNATURE_STATUS[sig.status] ?? sig.status ?? 'sin firma'}). No se ha ejecutado por seguridad; vuelve a intentarlo.`
        )
      }
      if (signal.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
      this.set({ detail: 'Instalando Ollama…' })
      let code: number
      try {
        code = await this.d.runInstaller(file)
      } catch (err) {
        throw new LocalAiError('installer', `No se ha podido ejecutar el instalador de Ollama: ${(err as Error).message}`)
      }
      if (code !== 0) throw new LocalAiError('installer', `El instalador de Ollama ha fallado (código ${code}). Vuelve a intentarlo.`)
      const exe = this.d.findInstall()
      if (!exe) throw new LocalAiError('installer', 'El instalador ha terminado pero no se encuentra Ollama en el equipo.')
      if (signal.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
      return exe
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async startServer(url: string, exe: string, justInstalled: boolean, signal: AbortSignal): Promise<void> {
    this.set({ stage: 'start', detail: 'Iniciando Ollama…', progress: undefined })
    const timeout = this.d.startTimeoutMs ?? 60_000
    const poll = this.d.pollMs ?? 1000
    const t0 = Date.now()
    // Tras instalar, el propio instalador abre Ollama: se le da un margen antes de lanzarlo.
    let launched = false
    if (!justInstalled) {
      this.d.launch(exe)
      launched = true
    }
    while (Date.now() - t0 < timeout) {
      if (signal.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
      if ((await this.ping(url)) !== null) return
      if (!launched && Date.now() - t0 > Math.min(15_000, timeout / 3)) {
        this.d.launch(exe)
        launched = true
      }
      await new Promise((r) => setTimeout(r, poll))
    }
    throw new LocalAiError('start', `Ollama está instalado pero no responde en ${url}. Reinicia el equipo o ábrelo desde el menú Inicio y pulsa Reintentar.`)
  }

  private async pull(url: string, model: string, signal: AbortSignal): Promise<void> {
    this.set({ stage: 'model', detail: `Descargando ${model}…`, progress: { done: 0, total: 0, bytesPerSec: 0 } })
    // Tamaño exacto del registro para que la barra no salte al aparecer cada capa; si no, el aproximado.
    const exact = await this.d.modelBytes(model).catch(() => 0)
    const expected = exact || knownModelBytes(model)
    const dir = this.d.modelsDir()
    const free = await this.d.freeBytes(dir).catch(() => Infinity)
    const need = expected + 1 * GB
    if (expected && free < need) {
      throw new LocalAiError('disk', `No hay espacio suficiente para el modelo ${model}: hacen falta unos ${fmtGb(need)} libres en ${parsePath(dir).root} y hay ${fmtGb(free)}.`)
    }

    let res: Response
    try {
      res = await this.d.fetch(normalizeUrl(url) + '/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal
      })
    } catch (err) {
      if (isAbort(err)) throw err
      throw new LocalAiError('start', `Ollama ha dejado de responder en ${url}. Pulsa Reintentar.`)
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      let msg = body
      try {
        msg = (JSON.parse(body) as { error?: string }).error ?? body
      } catch {
        /* texto plano */
      }
      throw explainPullError(msg || `HTTP ${res.status}`, model)
    }

    const layers = new Map<string, { total: number; completed: number }>()
    const meter = new SpeedMeter(this.d.now)
    let success = false
    const handle = (line: string): void => {
      if (!line.trim()) return
      let chunk: { status?: string; digest?: string; total?: number; completed?: number; error?: string }
      try {
        chunk = JSON.parse(line)
      } catch {
        return
      }
      if (chunk.error) throw explainPullError(chunk.error, model)
      if (chunk.digest && chunk.total) {
        layers.set(chunk.digest, { total: chunk.total, completed: chunk.completed ?? 0 })
        let done = 0
        let total = 0
        for (const l of layers.values()) {
          done += l.completed
          total += l.total
        }
        this.set({ detail: `Descargando ${model}…`, progress: this.progress(meter, done, Math.max(total, exact)) }, true)
      } else if (chunk.status === 'success') success = true
      else if (chunk.status && /verifying|writing/i.test(chunk.status)) this.set({ detail: 'Comprobando el modelo…' }, true)
    }
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(part, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        lines.forEach(handle)
      }
      handle(buffer + decoder.decode())
    } catch (err) {
      if (err instanceof LocalAiError || isAbort(err) || signal.aborted) throw err
      throw new LocalAiError('pull', `La descarga del modelo se ha cortado. Pulsa Reintentar: continuará donde se quedó.`)
    }
    if (!success) throw new LocalAiError('pull', 'La descarga del modelo se ha cortado. Pulsa Reintentar: continuará donde se quedó.')
    // El último aviso de progreso podía quedar pendiente: se envía completo antes de pasar a "Listo".
    if (this.state.progress) this.set({ progress: { ...this.state.progress, done: this.state.progress.total } })
  }
}

export { STAGES as LOCAL_AI_STAGES }

// ---------------- dependencias reales (Windows) ----------------

/** ollama.exe en la instalación por usuario o en el PATH. */
export function findOllamaExe(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = []
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'))
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) if (dir.trim()) candidates.push(join(dir.trim(), 'ollama.exe'))
  return candidates.find((p) => existsSync(p)) ?? null
}

const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/** Firma Authenticode con Get-AuthenticodeSignature: tiene que ser válida y de Ollama Inc. */
export function verifyAuthenticode(file: string): Promise<VerifyResult> {
  // La ruta va por variable de entorno para no interpolarla en el comando.
  const script =
    '$s = Get-AuthenticodeSignature -LiteralPath $env:MN_SIGNED_FILE; ' +
    '[pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress'
  return new Promise((resolve) => {
    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, MN_SIGNED_FILE: file }, windowsHide: true, timeout: 120_000 },
      (err, stdout) => {
        if (err) return resolve({ valid: false, status: `Error: ${err.message}`, subject: '' })
        try {
          const r = JSON.parse(stdout.trim()) as { status: string; subject: string }
          resolve({ valid: r.status === 'Valid' && OLLAMA_SIGNER.test(r.subject ?? ''), status: r.status, subject: r.subject ?? '' })
        } catch {
          resolve({ valid: false, status: 'Desconocido', subject: '' })
        }
      }
    )
  })
}

/** Ejecuta el instalador de Inno Setup en silencio y espera solo a su proceso (no a Ollama, que abre al terminar). */
export function runInstallerSilently(file: string): Promise<number> {
  markStartHidden()
  return new Promise((resolve, reject) => {
    const child = spawn(file, INSTALLER_ARGS, { stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? -1))
  })
}

/** Con este fichero, la app de Ollama arranca en la bandeja sin abrir su ventana (lo usa su install.ps1). */
function markStartHidden(): void {
  if (!process.env.LOCALAPPDATA) return
  try {
    const dir = join(process.env.LOCALAPPDATA, 'Ollama')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'upgraded'), '')
  } catch {
    /* solo evita que se abra la ventana */
  }
}

/** Arranca la app de bandeja de Ollama (o `ollama serve` si no está) sin ventana y desligada de esta app. */
export function launchOllama(exe: string): void {
  const app = join(dirname(exe), 'ollama app.exe')
  const opts = { detached: true, stdio: 'ignore' as const, windowsHide: true }
  if (existsSync(app)) {
    markStartHidden()
    spawn(app, [], opts).unref()
  } else spawn(exe, ['serve'], opts).unref()
}

export async function freeBytes(dir: string): Promise<number> {
  // Si la carpeta aún no existe, se mira la unidad de la que colgará.
  let p = dir
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p)
  const s = await fsp.statfs(p)
  return s.bavail * s.bsize
}

export const ollamaModelsDir = (): string => process.env.OLLAMA_MODELS || join(homedir(), '.ollama', 'models')

/** Suma de las capas del modelo según el registro de Ollama. */
export async function registryModelBytes(doFetch: typeof fetch, model: string): Promise<number> {
  const [name, tag = 'latest'] = model.split(':')
  const repo = name.includes('/') ? name : `library/${name}`
  const res = await doFetch(`https://registry.ollama.ai/v2/${repo}/manifests/${tag}`, {
    headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) return 0
  const m = (await res.json()) as { config?: { size?: number }; layers?: { size?: number }[] }
  return (m.config?.size ?? 0) + (m.layers ?? []).reduce((a, l) => a + (l.size ?? 0), 0)
}

export function systemDeps(): Pick<
  LocalAiDeps,
  'fetch' | 'platform' | 'tempDir' | 'installerUrl' | 'findInstall' | 'verify' | 'runInstaller' | 'launch' | 'totalMem' | 'freeBytes' | 'modelsDir' | 'modelBytes'
> {
  return {
    fetch: globalThis.fetch,
    platform: process.platform,
    tempDir: () => join(tmpdir(), 'meeting-notes'),
    installerUrl: OLLAMA_INSTALLER_URL,
    findInstall: () => findOllamaExe(),
    verify: verifyAuthenticode,
    runInstaller: runInstallerSilently,
    launch: launchOllama,
    totalMem: totalmem,
    freeBytes,
    modelsDir: ollamaModelsDir,
    modelBytes: (model) => registryModelBytes(globalThis.fetch, model)
  }
}
