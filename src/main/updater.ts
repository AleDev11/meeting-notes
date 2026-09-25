import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

const RELEASES_URL = 'https://github.com/AleDev11/meeting-notes/releases'
const CHECK_INTERVAL = 4 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle', currentVersion: app.getVersion() }
let notify: (s: UpdateState) => void = () => {}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  notify(state)
}

export const getUpdateState = (): UpdateState => state

/** Mensaje comprensible en lugar del error técnico de electron-updater. */
function friendly(message: string): string {
  if (/latest.yml|404/i.test(message)) return 'Se está publicando una versión nueva. Vuelve a buscar en unos minutos.'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::|network/i.test(message)) {
    return 'Sin conexión con el servidor de actualizaciones.'
  }
  return 'No se ha podido comprobar ahora. Inténtalo más tarde.'
}

export function checkForUpdates(): void {
  // Con la actualización ya descargada no hace falta volver a comprobar.
  if (state.status === 'unsupported' || state.status === 'ready' || state.status === 'downloading') return
  set({ status: 'checking', error: undefined })
  autoUpdater.checkForUpdates().catch((e: Error) => set({ status: 'error', error: friendly(e.message) }))
}

export function installUpdate(): void {
  if (state.status !== 'ready') return
  // Instalación silenciosa y se vuelve a abrir la app con la versión nueva.
  autoUpdater.quitAndInstall(true, true)
}

export function initUpdater(onChange: (s: UpdateState) => void): void {
  notify = onChange
  // En desarrollo no hay instalador que actualizar.
  if (!app.isPackaged) {
    state = { ...state, status: 'unsupported' }
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) =>
    set({ status: 'downloading', version: info.version, percent: 0, releaseUrl: `${RELEASES_URL}/tag/v${info.version}` })
  )
  autoUpdater.on('update-not-available', () => set({ status: 'up-to-date' }))
  autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (e) => set({ status: 'error', error: friendly(e.message) }))

  setTimeout(checkForUpdates, 5000)
  setInterval(checkForUpdates, CHECK_INTERVAL)
}
