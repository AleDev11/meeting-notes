import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { animate, AnimatePresence, motion, useMotionValue } from 'motion/react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { quick, soft } from './ui'

export interface LightboxImage {
  id: string
  url: string
  name: string
  width: number
  height: number
}

interface Props {
  images: LightboxImage[]
  /** Imagen abierta, o null si el visor está cerrado. */
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
}

// Margen alrededor de la imagen ajustada a la pantalla (deja sitio a la cabecera y las flechas).
const PAD_X = 76
const PAD_Y = 64

function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = (): void => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vp
}

export function Lightbox({ images, index, onIndex, onClose }: Props): React.JSX.Element {
  const open = index !== null && images.length > 0
  const i = open ? Math.min(index, images.length - 1) : 0
  const [dir, setDir] = useState(0)
  const vp = useViewport()

  const go = (delta: number): void => {
    if (images.length < 2) return
    setDir(delta)
    onIndex((i + delta + images.length) % images.length)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const img = images[i]
  return createPortal(
    <AnimatePresence>
      {open && img && (
        <motion.div
          key="lightbox"
          className="lightbox"
          role="dialog"
          aria-label="Vista previa de la imagen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={quick}
          onClick={onClose}
        >
          <div className="lb-stage">
            <AnimatePresence initial={false} custom={dir}>
              <motion.div
                key={img.id}
                className="lb-slide"
                custom={dir}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: d * 40, scale: d ? 1 : 0.97 }),
                  center: { opacity: 1, x: 0, scale: 1 },
                  exit: (d: number) => ({ opacity: 0, x: d * -40 })
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={soft}
              >
                <Slide image={img} vp={vp} />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="lb-top" onClick={(e) => e.stopPropagation()}>
            <span className="lb-name" title={img.name}>
              {img.name}
            </span>
            {images.length > 1 && (
              <span className="lb-count">
                {i + 1} / {images.length}
              </span>
            )}
            <span className="grow" />
            <button className="lb-btn" onClick={onClose} aria-label="Cerrar (Esc)" title="Cerrar (Esc)">
              <X size={18} />
            </button>
          </div>

          {images.length > 1 && (
            <>
              <button
                className="lb-btn lb-nav lb-prev"
                aria-label="Anterior"
                title="Anterior (←)"
                onClick={(e) => {
                  e.stopPropagation()
                  go(-1)
                }}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="lb-btn lb-nav lb-next"
                aria-label="Siguiente"
                title="Siguiente (→)"
                onClick={(e) => {
                  e.stopPropagation()
                  go(1)
                }}
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/**
 * Una imagen del visor. Se pinta a su tamaño real y se reduce con scale para ajustarla
 * a la pantalla: así al ampliar al 100 % se ve nítida. Ampliada, se puede arrastrar.
 */
function Slide({ image, vp }: { image: LightboxImage; vp: { w: number; h: number } }): React.JSX.Element {
  const [nat, setNat] = useState({ w: image.width || 1, h: image.height || 1 })
  const [zoomed, setZoomed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const down = useRef({ x: 0, y: 0 })

  const fit = Math.min(1, (vp.w - PAD_X * 2) / nat.w, (vp.h - PAD_Y * 2) / nat.h)
  const canZoom = fit < 0.995
  const ox = Math.max(0, (nat.w - vp.w) / 2)
  const oy = Math.max(0, (nat.h - vp.h) / 2)
  const clamp = (v: number, max: number): number => Math.max(-max, Math.min(max, v))

  // Al cambiar el tamaño de la ventana, que la imagen no quede fuera de los límites.
  useEffect(() => {
    x.set(clamp(x.get(), ox))
    y.set(clamp(y.get(), oy))
  }, [ox, oy, x, y])

  const toggle = (e: React.MouseEvent): void => {
    e.stopPropagation()
    // El segundo clic de un doble clic no deshace el primero; tampoco cuenta soltar tras arrastrar.
    if (e.detail > 1 || Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 4) return
    if (!canZoom) return
    if (zoomed) {
      animate(x, 0, soft)
      animate(y, 0, soft)
    } else {
      // Amplía hacia el punto donde se ha hecho clic.
      const s = 1 / fit
      animate(x, clamp(-(e.clientX - vp.w / 2) * (s - 1), ox), soft)
      animate(y, clamp(-(e.clientY - vp.h / 2) * (s - 1), oy), soft)
    }
    setZoomed(!zoomed)
  }

  return (
    <motion.div
      className="lb-pan"
      style={{ x, y, width: nat.w, height: nat.h, marginLeft: -nat.w / 2, marginTop: -nat.h / 2 }}
      drag={zoomed}
      dragConstraints={{ left: -ox, right: ox, top: -oy, bottom: oy }}
      dragElastic={0.06}
      dragTransition={{ power: 0.2, timeConstant: 180 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
    >
      <motion.img
        src={image.url}
        alt={image.name}
        draggable={false}
        className={['lb-img', canZoom ? (zoomed ? (dragging ? 'grabbing' : 'zoomed') : 'can-zoom') : ''].join(' ')}
        initial={false}
        // El radio se compensa con la escala para que se vea igual a cualquier tamaño.
        animate={{ scale: zoomed ? 1 : fit, borderRadius: zoomed ? 0 : 8 / fit }}
        transition={soft}
        onLoad={(e) => {
          const el = e.currentTarget
          if (el.naturalWidth && (el.naturalWidth !== nat.w || el.naturalHeight !== nat.h)) {
            setNat({ w: el.naturalWidth, h: el.naturalHeight })
          }
        }}
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onClick={toggle}
      />
    </motion.div>
  )
}
