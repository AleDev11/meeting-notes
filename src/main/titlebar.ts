import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

/**
 * Barra de título propia: la ventana principal no tiene la de Windows y los botones
 * de minimizar, maximizar y cerrar los pinta el renderer. Minimizar y cerrar pasan por
 * los eventos normales de la ventana, así que la bandeja del sistema sigue funcionando.
 */

const from = (e: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(e.sender)

export function registerWindowControls(): void {
  ipcMain.on('window:minimize', (e) => from(e)?.minimize())
  ipcMain.on('window:toggleMaximize', (e) => {
    const w = from(e)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('window:close', (e) => from(e)?.close())
  ipcMain.handle('window:isMaximized', (e) => from(e)?.isMaximized() ?? false)
}

/** Avisa al renderer cuando la ventana se maximiza o se restaura (el icono cambia). */
export function watchMaximize(w: BrowserWindow): void {
  const send = (): void => {
    if (!w.isDestroyed()) w.webContents.send('window:maximized', w.isMaximized())
  }
  w.on('maximize', send)
  w.on('unmaximize', send)
  // Al restaurar desde la bandeja o la barra de tareas el estado puede haber cambiado.
  w.on('restore', send)
  w.on('show', send)
}
