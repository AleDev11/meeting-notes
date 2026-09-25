import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import App from './App'
import MiniApp from './MiniApp'
import './styles.css'

// Soltar un archivo fuera de las notas no debe abrirlo en la ventana (se perdería la app).
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'none'
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}>
      {location.hash === '#mini' ? <MiniApp /> : <App />}
    </MotionConfig>
  </StrictMode>
)
