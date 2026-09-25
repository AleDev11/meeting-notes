import { app, dialog, ipcMain, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import type { AppAction, Settings } from '../shared/types'
import { loadSettings } from './settings'

/**
 * Funcionamiento en segundo plano: icono en la bandeja del sistema con acciones
 * rápidas, acciones en el icono de la barra de tareas, inicio con Windows y qué
 * hacer al minimizar o cerrar la ventana.
 */

const HIDDEN_ARG = '--hidden'
const ACTION_ARG = '--action='

let tray: Tray | null = null
let quitting = false
let hintShown = false
let recState = { recording: false, paused: false }

interface Options {
  getWin: () => BrowserWindow | null
  icon: string
}

/** true si la app se abrió al iniciar Windows: arranca oculta en la bandeja. */
export const startHidden = (): boolean => process.argv.includes(HIDDEN_ARG)

const actionFrom = (argv: string[]): AppAction | null =>
  (argv.find((a) => a.startsWith(ACTION_ARG))?.slice(ACTION_ARG.length) as AppAction) ?? null

/** Aplica "Iniciar con Windows". Solo en la versión instalada: en desarrollo registraría Electron. */
export function applyLoginItem(s: Settings): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: s.openAtLogin, args: [HIDDEN_ARG] })
}

export function setupBackground({ getWin, icon }: Options): void {
  const show = (): void => {
    const w = getWin()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  /**
   * Las acciones se ejecutan en la ventana como si el usuario hubiera pulsado un botón
   * (userGesture): así se puede empezar a capturar audio sin abrir la ventana antes.
   */
  const run = (action: AppAction): void => {
    const w = getWin()
    if (!w) return
    if (action === 'open') return show()
    if (action === 'new-meeting' || action === 'record') show()
    const call = (): void => void w.webContents.executeJavaScript(`window.__appAction?.(${JSON.stringify(action)})`, true)
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', call)
    else call()
  }

  const quit = async (): Promise<void> => {
    if (recState.recording) {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Detener y salir', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
        title: 'Meeting Notes',
        message: 'Hay una grabación en curso',
        detail: 'Se detendrá y se guardará antes de salir.'
      })
      if (response !== 0) return
      return run('stop-and-quit')
    }
    quitting = true
    app.quit()
  }

  // ---------- bandeja ----------
  const image = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  const rebuild = (): void => {
    const { recording, paused } = recState
    tray?.setToolTip(recording ? (paused ? 'Meeting Notes · en pausa' : 'Meeting Notes · grabando') : 'Meeting Notes')
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Meeting Notes', click: show },
        { type: 'separator' },
        ...(recording
          ? [
              { label: 'Detener grabación', click: () => run('stop') },
              { label: paused ? 'Reanudar grabación' : 'Pausar grabación', click: () => run('pause') },
              { label: 'Modo mini', click: () => run('mini') }
            ]
          : [
              { label: 'Nueva reunión y grabar', click: () => run('record') },
              { label: 'Nueva reunión', click: () => run('new-meeting') }
            ]),
        { type: 'separator' },
        { label: 'Salir', click: () => void quit() }
      ])
    )
  }
  rebuild()
  tray.on('click', show)

  ipcMain.on('recording:state', (_e, s: typeof recState) => {
    recState = s
    rebuild()
  })
  ipcMain.handle('app:quit', () => {
    quitting = true
    app.quit()
  })

  // ---------- barra de tareas (clic derecho en el icono) ----------
  if (app.isPackaged) {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: `${ACTION_ARG}record`,
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Nueva reunión y grabar',
        description: 'Crea una reunión y empieza a grabar'
      },
      {
        program: process.execPath,
        arguments: `${ACTION_ARG}new-meeting`,
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Nueva reunión',
        description: 'Crea una reunión vacía'
      }
    ])
  }

  // Una sola instancia: abrir la app otra vez (o una acción rápida) reutiliza la que ya está abierta.
  app.on('second-instance', (_e, argv) => run(actionFrom(argv) ?? 'open'))
  const initial = actionFrom(process.argv)
  if (initial) run(initial)

  // ---------- minimizar y cerrar ----------
  const toTray = (w: BrowserWindow): void => {
    w.hide()
    if (!hintShown) {
      hintShown = true
      tray?.displayBalloon({
        iconType: 'info',
        title: 'Meeting Notes sigue abierto',
        content: 'Está en la bandeja del sistema, junto al reloj.'
      })
    }
  }
  const w = getWin()
  if (w) {
    w.on('minimize', () => {
      if (loadSettings().minimizeToTray) toTray(w)
    })
    w.on('close', (e) => {
      if (quitting) return
      if (loadSettings().closeToTray) {
        e.preventDefault()
        toTray(w)
      } else if (recState.recording) {
        e.preventDefault()
        void quit()
      } else quitting = true
    })
  }
  app.on('before-quit', () => (quitting = true))

  applyLoginItem(loadSettings())
}

/** Bloqueo de instancia única. false si ya hay otra abierta y esta debe cerrarse. */
export const claimSingleInstance = (): boolean => app.requestSingleInstanceLock()
