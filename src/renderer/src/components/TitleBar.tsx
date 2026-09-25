import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import '../titlebar.css'

/**
 * Barra de título de la ventana principal. Es una franja transparente sobre la parte
 * alta de la barra lateral y del área principal: se arrastra para mover la ventana
 * (doble clic la maximiza, como en Windows) y a la derecha están los botones.
 */
export function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const [focused, setFocused] = useState(() => document.hasFocus())

  useEffect(() => {
    void window.api.isWindowMaximized().then(setMaximized)
    return window.api.onWindowMaximized(setMaximized)
  }, [])

  // Como en Windows, los botones se apagan cuando la ventana no está activa.
  useEffect(() => {
    const on = (): void => setFocused(true)
    const off = (): void => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])

  return (
    <div className={`titlebar ${focused ? '' : 'is-inactive'}`}>
      <div className="win-controls">
        <button className="win-btn" onClick={() => window.api.minimizeWindow()} title="Minimizar" aria-label="Minimizar">
          <Minus size={16} strokeWidth={1} absoluteStrokeWidth />
        </button>
        <button
          className="win-btn"
          onClick={() => window.api.toggleMaximizeWindow()}
          title={maximized ? 'Restaurar' : 'Maximizar'}
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        >
          {maximized ? (
            <Copy size={12} strokeWidth={1} absoluteStrokeWidth className="win-restore" />
          ) : (
            <Square size={13} strokeWidth={1} absoluteStrokeWidth />
          )}
        </button>
        <button className="win-btn close" onClick={() => window.api.closeWindow()} title="Cerrar" aria-label="Cerrar">
          <X size={19} strokeWidth={1} absoluteStrokeWidth />
        </button>
      </div>
    </div>
  )
}
