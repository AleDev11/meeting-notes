import { app, ipcMain } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { LocalAiState, Settings } from '../shared/types'
import { LocalAiManager, systemDeps, type LocalAiDeps } from './local-ai'
import { loadSettings, saveSettings } from './settings'

let manager: LocalAiManager | null = null

const pendingFile = (): string => join(app.getPath('userData'), 'local-ai.json')

const STAGE_NAMES: Record<string, string> = {
  download: 'descargando Ollama',
  install: 'instalando Ollama',
  start: 'iniciando Ollama',
  model: 'descargando el modelo'
}

/**
 * Solo para pruebas: MEETING_NOTES_FAKE_OLLAMA_INSTALL=<url de un servidor simulado> sustituye
 * la instalación real (descarga del servidor simulado, firma dada por buena salvo
 * MEETING_NOTES_FAKE_SIGNATURE=bad, instalador que solo espera) para poder ver el asistente
 * sin tocar el sistema.
 */
function fakeInstallDeps(base: string): Partial<LocalAiDeps> {
  let installed = false
  const post = (path: string): void => void fetch(base + path, { method: 'POST' }).catch(() => {})
  return {
    platform: 'win32',
    installerUrl: base + '/OllamaSetup.exe',
    findInstall: () => (installed ? 'C:\\fake\\ollama.exe' : null),
    verify: async () =>
      process.env.MEETING_NOTES_FAKE_SIGNATURE === 'bad'
        ? { valid: false, status: 'HashMismatch', subject: '' }
        : { valid: true, status: 'Valid', subject: 'CN=Ollama Inc., O=Ollama Inc., L=Toronto, S=Ontario, C=CA' },
    runInstaller: async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.MEETING_NOTES_FAKE_INSTALL_MS) || 4000))
      installed = true
      // Como el instalador real, deja Ollama abierto al terminar.
      post('/__start')
      return 0
    },
    launch: () => post('/__start'),
    modelBytes: async () => 0
  }
}

export function registerLocalAi(emit: (channel: string, payload: unknown) => void): LocalAiManager {
  const fake = process.env.MEETING_NOTES_FAKE_OLLAMA_INSTALL
  manager = new LocalAiManager({
    ...systemDeps(),
    ...(fake ? fakeInstallDeps(fake.replace(/\/+$/, '')) : {}),
    loadConfig: () => ({ url: loadSettings().ollamaUrl }),
    configure: ({ url, model }) => {
      const patch: Partial<Settings> = { llmProvider: 'ollama', ollamaUrl: url, ollamaModel: model }
      saveSettings({ ...loadSettings(), ...patch })
      // Las ventanas tienen su copia de la configuración: que no la pisen con la antigua.
      emit('settings:patched', patch)
    },
    persist: (pending) => {
      try {
        if (pending) writeFileSync(pendingFile(), JSON.stringify(pending))
        else if (existsSync(pendingFile())) rmSync(pendingFile())
      } catch {
        /* solo sirve para retomar al abrir la app */
      }
    },
    emit: (s: LocalAiState) => emit('localAi:state', s)
  })
  const m = manager

  ipcMain.handle('localAi:get', () => m.getState())
  ipcMain.handle('localAi:detect', () => m.detect())
  ipcMain.handle('localAi:start', (_e, opts?: { model?: string }) => {
    void m.start(opts ?? {})
  })
  ipcMain.handle('localAi:cancel', () => m.cancel())

  // Si se cerró la app a medias, se retoma (Ollama continúa las descargas de modelos donde se quedaron).
  try {
    if (existsSync(pendingFile())) {
      const pending = JSON.parse(readFileSync(pendingFile(), 'utf8')) as { model?: string }
      setTimeout(() => void m.start({ model: pending.model }), 3000)
    }
  } catch {
    /* fichero dañado: se ignora */
  }
  return m
}

/** Los resúmenes con Ollama esperan a que la IA local esté lista. */
export function assertLocalAiReady(s: Settings): void {
  const st = manager?.getState()
  if (s.llmProvider !== 'ollama' || !st || st.status !== 'running') return
  // Descargando otro modelo con Ollama ya en marcha: el configurado sigue funcionando.
  if (st.stage === 'model' && st.model !== s.ollamaModel) return
  const pct = st.progress?.total ? ` (${Math.floor((st.progress.done / st.progress.total) * 100)} %)` : ''
  throw new Error(
    `La IA local aún se está preparando: ${STAGE_NAMES[st.stage ?? ''] ?? 'comprobando el equipo'}${pct}. Podrás usarla en cuanto termine; ve el progreso en Configuración > IA para resúmenes.`
  )
}
