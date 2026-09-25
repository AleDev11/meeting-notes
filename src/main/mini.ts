import { BrowserWindow, ipcMain, screen, type Rectangle } from 'electron'
import { join } from 'path'
import type { MiniCommand, MiniState } from '../shared/types'

/**
 * Modo mini: una ventana pequeña, siempre visible y que se puede mover, con la
 * transcripción en directo y los controles de la grabación. La ventana principal
 * se oculta mientras tanto; la grabación sigue en ella.
 */
let mini: BrowserWindow | null = null
let lastState: MiniState | null = null
let lastBounds: Rectangle | null = null

export function registerMini(getMain: () => BrowserWindow | null, icon: string): void {
  const open = (): void => {
    if (mini) return mini.focus()
    const main = getMain()
    const { workArea } = screen.getDisplayMatching(main?.getBounds() ?? screen.getPrimaryDisplay().bounds)
    const width = 380
    const height = 240
    mini = new BrowserWindow({
      ...(lastBounds ?? {
        width,
        height,
        x: workArea.x + workArea.width - width - 24,
        y: workArea.y + workArea.height - height - 24
      }),
      minWidth: 300,
      minHeight: 150,
      frame: false,
      alwaysOnTop: true,
      maximizable: false,
      fullscreenable: false,
      title: 'Meeting Notes',
      backgroundColor: '#121214',
      icon,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        backgroundThrottling: false
      }
    })
    mini.setAlwaysOnTop(true, 'floating')
    if (process.env['ELECTRON_RENDERER_URL']) mini.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#mini`)
    else mini.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' })
    mini.on('close', () => (lastBounds = mini!.getBounds()))
    mini.on('closed', () => {
      mini = null
      const w = getMain()
      w?.show()
      w?.focus()
      w?.webContents.send('mini:closed')
    })
    main?.hide()
  }

  ipcMain.handle('mini:open', () => open())
  ipcMain.handle('mini:close', () => mini?.close())
  ipcMain.handle('mini:state', () => lastState)
  ipcMain.on('mini:state', (_e, s: MiniState) => {
    lastState = s
    mini?.webContents.send('mini:state', s)
  })
  ipcMain.on('mini:command', (_e, cmd: MiniCommand) => {
    if (cmd === 'expand') mini?.close()
    else if (cmd === 'toggleScreen') void getMain()?.webContents.executeJavaScript('window.__appAction?.("toggle-screen")', true)
    else getMain()?.webContents.send('mini:command', cmd)
  })
}
