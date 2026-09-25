import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ScreenSource } from '@shared/types'
import { quick, soft } from './ui'

export interface ScreenChoice {
  screen: boolean
  displayId: string
  /** No volver a preguntar: se usa esta elección en las próximas grabaciones. */
  remember: boolean
}

/**
 * Al empezar a grabar: ¿grabar también la pantalla?, y cuál. null = cancelar la grabación.
 */
export function ScreenPrompt(p: {
  open: boolean
  initial: { screen: boolean; displayId: string }
  onClose: (choice: ScreenChoice | null) => void
}): React.JSX.Element {
  const [screens, setScreens] = useState<ScreenSource[] | null>(null)
  const [displayId, setDisplayId] = useState(p.initial.displayId)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (!p.open) return
    setScreens(null)
    setRemember(false)
    void window.api.listScreens().then((list) => {
      setScreens(list)
      if (!list.some((s) => s.displayId === p.initial.displayId)) setDisplayId(list[0]?.displayId ?? '')
      else setDisplayId(p.initial.displayId)
    })
  }, [p.open, p.initial.displayId])

  const choose = (screen: boolean): void => p.onClose({ screen, displayId, remember })

  return (
    <AnimatePresence>
      {p.open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={quick}
          onMouseDown={() => p.onClose(null)}
        >
          <motion.div
            className="modal screen-prompt"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={soft}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') p.onClose(null)
            }}
          >
            <h3>¿Grabar también la pantalla?</h3>
            <p className="modal-msg">
              Útil si en la reunión se comparten presentaciones. Podrás activarla o desactivarla durante la grabación.
            </p>
            {!screens ? (
              <p className="modal-msg">Buscando pantallas…</p>
            ) : (
              <div className="screen-grid">
                {screens.map((s) => (
                  <button
                    key={s.id}
                    className={`screen-option ${s.displayId === displayId ? 'current' : ''}`}
                    onClick={() => setDisplayId(s.displayId)}
                    onDoubleClick={() => p.onClose({ screen: true, displayId: s.displayId, remember })}
                  >
                    <img src={s.thumbnail} alt="" />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              No volver a preguntar
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => p.onClose(null)}>
                Cancelar
              </button>
              <button className="btn" autoFocus={!p.initial.screen} onClick={() => choose(false)}>
                Solo audio
              </button>
              <button className="btn primary" autoFocus={p.initial.screen} disabled={!screens?.length} onClick={() => choose(true)}>
                Grabar con pantalla
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
