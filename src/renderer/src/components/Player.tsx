import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronDown,
  Maximize,
  Minimize,
  MonitorPlay,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { fmtTime } from '../util'
import { Popover, quick, Spinner } from './ui'

export interface PlayerHandle {
  /** Salta a un segundo concreto y empieza a reproducir. */
  playFrom: (sec: number) => void
  /** Atajos de teclado. Devuelve true si la tecla era del reproductor. */
  handleKey: (e: KeyboardEvent | React.KeyboardEvent) => boolean
}

/** Tramo de la línea de tiempo en el que habla alguien. */
export interface PlayerMark {
  start: number
  end: number
  color: string
  label: string
}

interface Props {
  src: string
  video?: string
  videoOffset?: number
  duration: number
  marks?: PlayerMark[]
  onTime: (sec: number | null) => void
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
/** Desfase máximo entre el audio y el vídeo antes de corregirlo. */
const DRIFT = 0.35
const IDLE_MS = 2000
const STAGE_MIN = 140
const STAGE_DEFAULT = 280

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* sin almacenamiento */
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const pct = (v: number, total: number): string => `${total ? clamp((v / total) * 100, 0, 100) : 0}%`
const canPip = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled

/**
 * Reproductor de la grabación completa. El audio manda y, si se grabó la pantalla, el
 * vídeo lo sigue (sin sonido): así cuadran aunque la pantalla empezara a mitad de
 * reunión (videoOffset). La duración de lo grabado con MediaRecorder no siempre viene
 * en el fichero, así que se usa la de la reunión.
 */
export const Player = forwardRef<PlayerHandle, Props>(function Player(
  { src, video, videoOffset = 0, duration, marks = [], onTime },
  ref
) {
  const audio = useRef<HTMLAudioElement>(null)
  const screen = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(() => clamp(Number(store.get('player.volume') ?? 1), 0, 1))
  const [muted, setMuted] = useState(false)
  const [buffered, setBuffered] = useState<[number, number][]>([])
  const [waiting, setWaiting] = useState(false)
  const [videoWaiting, setVideoWaiting] = useState(false)
  const [showVideo, setShowVideo] = useState(() => store.get('player.video') !== '0')
  const [stageH, setStageH] = useState(() => Number(store.get('player.stageHeight')) || STAGE_DEFAULT)
  const [fullscreen, setFullscreen] = useState(false)
  const [pip, setPip] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [idle, setIdle] = useState(false)
  const [overBar, setOverBar] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const withVideo = !!video && showVideo

  const total = (): number => {
    const d = audio.current?.duration
    return d && Number.isFinite(d) ? d : duration
  }

  /** Pone el vídeo en el punto que corresponde al audio. */
  const sync = (): void => {
    const a = audio.current
    const v = screen.current
    if (!a || !v) return
    const target = a.currentTime - videoOffset
    if (target < 0) {
      v.pause()
      v.currentTime = 0
      return
    }
    if (Math.abs(v.currentTime - target) > DRIFT) v.currentTime = target
    if (a.paused) v.pause()
    else if (v.paused) void v.play().catch(() => {})
  }

  const seek = (sec: number): void => {
    const a = audio.current
    if (!a) return
    a.currentTime = clamp(sec, 0, total() || sec)
    setTime(a.currentTime)
  }

  const toggle = (): void => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }

  const setVol = (v: number): void => {
    const a = audio.current
    if (!a) return
    a.volume = clamp(v, 0, 1)
    a.muted = v === 0
  }

  const toggleMute = (): void => {
    const a = audio.current
    if (!a) return
    if (a.muted || a.volume === 0) {
      a.muted = false
      if (a.volume === 0) a.volume = 0.6
    } else a.muted = true
  }

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else if (withVideo) void stage.current?.requestFullscreen()
  }

  const togglePip = (): void => {
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void screen.current?.requestPictureInPicture().catch(() => {})
  }

  /** Muestra los controles y los esconde al rato si no se mueve el ratón. */
  const poke = useCallback((): void => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
  }, [])

  const handleKey = (e: KeyboardEvent | React.KeyboardEvent): boolean => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return false
    const t = e.target as HTMLElement | null
    if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false
    const now = audio.current?.currentTime ?? 0
    switch (e.key.toLowerCase()) {
      case ' ':
      case 'k':
        toggle()
        break
      case 'j':
        seek(now - 10)
        break
      case 'l':
        seek(now + 10)
        break
      case 'arrowleft':
        seek(now - 5)
        break
      case 'arrowright':
        seek(now + 5)
        break
      case 'm':
        toggleMute()
        break
      case 'f':
        if (!withVideo) return false
        toggleFullscreen()
        break
      default:
        return false
    }
    if (withVideo) poke()
    return true
  }

  useImperativeHandle(ref, () => ({
    playFrom: (sec) => {
      seek(sec)
      void audio.current?.play().catch(() => {})
    },
    handleKey
  }))

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
    if (screen.current) screen.current.playbackRate = speed
  }, [speed, withVideo])

  // El volumen guardado solo se aplica al montar: después manda el propio elemento.
  const initialVolume = useRef(volume)
  useEffect(() => {
    if (audio.current) audio.current.volume = initialVolume.current
  }, [])

  useEffect(() => () => onTime(null), [onTime])
  useEffect(() => () => clearTimeout(idleTimer.current), [])

  // Movimiento suave de la barra mientras suena (timeupdate llega pocas veces por segundo).
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (): void => {
      if (audio.current) setTime(audio.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  useEffect(() => {
    const on = (): void => setFullscreen(!!stage.current && document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  useEffect(() => {
    const v = screen.current
    if (!v) return
    const enter = (): void => setPip(true)
    const leave = (): void => setPip(false)
    v.addEventListener('enterpictureinpicture', enter)
    v.addEventListener('leavepictureinpicture', leave)
    return () => {
      v.removeEventListener('enterpictureinpicture', enter)
      v.removeEventListener('leavepictureinpicture', leave)
    }
  }, [video])

  // Si se esconde el vídeo, fuera de pantalla completa y de PiP.
  useEffect(() => {
    if (withVideo) return
    if (document.fullscreenElement === stage.current) void document.exitFullscreen()
    if (document.pictureInPictureElement === screen.current) void document.exitPictureInPicture()
  }, [withVideo])

  const readBuffered = (): void => {
    const a = audio.current
    if (!a) return
    const len = total()
    const out: [number, number][] = []
    for (let i = 0; i < a.buffered.length; i++) out.push([a.buffered.start(i), Math.min(a.buffered.end(i), len)])
    setBuffered(out)
  }

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startH = stageH
    // Que quede sitio para leer la transcripción.
    const max = Math.max(STAGE_MIN, (root.current?.parentElement?.clientHeight ?? window.innerHeight) - 180)
    let h = startH
    const move = (ev: PointerEvent): void => {
      h = clamp(startH + startY - ev.clientY, STAGE_MIN, max)
      setStageH(h)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      store.set('player.stageHeight', String(Math.round(h)))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const setVideoShown = (v: boolean): void => {
    setShowVideo(v)
    store.set('player.video', v ? '1' : '0')
  }

  const len = total()
  const beforeVideo = !!video && time < videoOffset
  const busy = waiting || (videoWaiting && withVideo && !beforeVideo)
  const controlsShown = !playing || !idle || speedOpen || scrubbing || overBar

  const controls = (
    <div className="pl-controls">
      <Timeline
        time={time}
        total={len}
        buffered={buffered}
        marks={marks}
        onSeek={seek}
        onScrub={setScrubbing}
      />
      <div className="pl-row">
        <button className="pl-btn pl-play" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproducir'} title={playing ? 'Pausar (k)' : 'Reproducir (k)'}>
          {busy && !withVideo ? (
            <Spinner size={14} />
          ) : playing ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
        </button>
        <button className="pl-btn pl-hide-narrow" onClick={() => seek(time - 10)} title="Atrás 10 s (j)" aria-label="Atrás 10 segundos">
          <span className="pl-skip">
            <RotateCcw size={17} />
            <b>10</b>
          </span>
        </button>
        <button className="pl-btn pl-hide-narrow" onClick={() => seek(time + 10)} title="Adelante 10 s (l)" aria-label="Adelante 10 segundos">
          <span className="pl-skip">
            <RotateCw size={17} />
            <b>10</b>
          </span>
        </button>
        <div className="pl-volume">
          <button className="pl-btn" onClick={toggleMute} title={muted ? 'Activar sonido (m)' : 'Silenciar (m)'} aria-label={muted ? 'Activar sonido' : 'Silenciar'}>
            {muted || volume === 0 ? <VolumeX size={16} /> : volume < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
          </button>
          <Slider value={muted ? 0 : volume} onChange={setVol} label="Volumen" />
        </div>
        <span className="pl-time">
          {fmtTime(time)} <span className="pl-time-total">/ {fmtTime(len)}</span>
        </span>
        <span className="pl-spacer" />
        <span className="anchor">
          <button
            className={`pl-btn pl-speed ${speed !== 1 ? 'changed' : ''}`}
            onClick={() => setSpeedOpen(!speedOpen)}
            title="Velocidad de reproducción"
            aria-haspopup="menu"
            aria-expanded={speedOpen}
          >
            {speed}×
          </button>
          <Popover open={speedOpen} onClose={() => setSpeedOpen(false)} align="right" className="drop-up pop-speed">
            <div className="menu-heading">Velocidad</div>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`menu-item ${s === speed ? 'current' : ''}`}
                onClick={() => {
                  setSpeed(s)
                  setSpeedOpen(false)
                }}
              >
                <span className="mi-label">{s === 1 ? 'Normal' : `${s}×`}</span>
              </button>
            ))}
          </Popover>
        </span>
        {video &&
          (withVideo ? (
            <>
              {canPip && (
                <button
                  className={`pl-btn pl-hide-narrow ${pip ? 'on' : ''}`}
                  onClick={togglePip}
                  title={pip ? 'Volver a la ventana' : 'Imagen en imagen'}
                  aria-label="Imagen en imagen"
                >
                  <PictureInPicture2 size={16} />
                </button>
              )}
              {!fullscreen && (
                <button className="pl-btn" onClick={() => setVideoShown(false)} title="Solo audio" aria-label="Ocultar el vídeo">
                  <ChevronDown size={16} />
                </button>
              )}
              <button
                className="pl-btn"
                onClick={toggleFullscreen}
                title={fullscreen ? 'Salir de pantalla completa (f)' : 'Pantalla completa (f)'}
                aria-label="Pantalla completa"
              >
                {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </>
          ) : (
            <button className="pl-btn" onClick={() => setVideoShown(true)} title="Ver la pantalla" aria-label="Mostrar el vídeo">
              <MonitorPlay size={16} />
            </button>
          ))}
      </div>
    </div>
  )

  return (
    <div ref={root} className={`player ${withVideo ? 'mode-video' : 'mode-audio'}`}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => {
          setPlaying(true)
          sync()
        }}
        onPause={() => {
          setPlaying(false)
          setTime(audio.current?.currentTime ?? 0)
          onTime(null)
          sync()
        }}
        onEnded={() => {
          setPlaying(false)
          onTime(null)
        }}
        onSeeking={() => setWaiting(true)}
        onSeeked={() => {
          setWaiting(false)
          sync()
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onProgress={readBuffered}
        onLoadedMetadata={readBuffered}
        onVolumeChange={(e) => {
          const a = e.currentTarget
          setMuted(a.muted)
          setVolume(a.volume)
          store.set('player.volume', String(a.volume))
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime
          setTime(t)
          if (!e.currentTarget.paused) onTime(t)
          sync()
        }}
      />

      {video && (
        <>
          {withVideo && !fullscreen && (
            <div
              className="pl-resize"
              onPointerDown={startResize}
              onDoubleClick={() => {
                setStageH(STAGE_DEFAULT)
                store.set('player.stageHeight', String(STAGE_DEFAULT))
              }}
              title="Arrastra para cambiar el tamaño"
            />
          )}
          <div
            ref={stage}
            tabIndex={-1}
            className={`pl-stage ${controlsShown ? '' : 'idle'}`}
            style={withVideo ? (fullscreen ? undefined : { height: stageH }) : { display: 'none' }}
            onMouseMove={poke}
            onMouseLeave={() => {
              clearTimeout(idleTimer.current)
              setIdle(true)
            }}
          >
            <video
              ref={screen}
              src={video}
              muted
              playsInline
              preload="metadata"
              className="pl-video"
              onClick={toggle}
              onDoubleClick={toggleFullscreen}
              onLoadedMetadata={(e) => {
                e.currentTarget.playbackRate = speed
                sync()
              }}
              onSeeking={() => setVideoWaiting(true)}
              onSeeked={() => setVideoWaiting(false)}
              onWaiting={() => setVideoWaiting(true)}
              onPlaying={() => setVideoWaiting(false)}
              onCanPlay={() => setVideoWaiting(false)}
              onPlay={() => {
                // Desde la ventana de PiP: el audio sigue al vídeo.
                if (document.pictureInPictureElement === screen.current && audio.current?.paused) void audio.current.play()
              }}
              onPause={() => {
                const a = audio.current
                if (
                  document.pictureInPictureElement === screen.current &&
                  a &&
                  !a.paused &&
                  a.currentTime >= videoOffset &&
                  !a.ended
                )
                  a.pause()
              }}
            />
            {beforeVideo && (
              <div className="pl-note" onClick={toggle} onDoubleClick={(e) => e.stopPropagation()}>
                <MonitorPlay size={22} />
                <span>La pantalla empieza en {fmtTime(videoOffset)}</span>
                <button
                  className="pl-note-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    seek(videoOffset)
                  }}
                >
                  Saltar ahí
                </button>
              </div>
            )}
            {pip && !beforeVideo && (
              <div className="pl-note" onClick={toggle}>
                <PictureInPicture2 size={22} />
                <span>Reproduciendo en imagen en imagen</span>
              </div>
            )}
            <AnimatePresence>
              {busy ? (
                <motion.div key="busy" className="pl-center" {...pop}>
                  <Spinner size={30} />
                </motion.div>
              ) : (
                !playing &&
                !beforeVideo &&
                !pip && (
                  <motion.div key="play" className="pl-center big-play" {...pop}>
                    <Play size={26} fill="currentColor" />
                  </motion.div>
                )
              )}
            </AnimatePresence>
            <div
              className="pl-overlay"
              onMouseEnter={() => setOverBar(true)}
              onMouseLeave={() => setOverBar(false)}
            >
              {withVideo && controls}
            </div>
          </div>
        </>
      )}

      {!withVideo && <div className="pl-bar">{controls}</div>}
    </div>
  )
})

const pop = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 1.1 },
  transition: quick
}

// ---------------- línea de tiempo ----------------

function Timeline({
  time,
  total,
  buffered,
  marks,
  onSeek,
  onScrub
}: {
  time: number
  total: number
  buffered: [number, number][]
  marks: PlayerMark[]
  onSeek: (sec: number) => void
  onScrub: (v: boolean) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; w: number; sec: number } | null>(null)
  const [drag, setDrag] = useState(false)

  const at = (clientX: number): { x: number; w: number; sec: number } => {
    const r = ref.current!.getBoundingClientRect()
    const x = clamp(clientX - r.left, 0, r.width)
    return { x, w: r.width, sec: r.width ? (x / r.width) * total : 0 }
  }

  const speaker = hover ? marks.find((m) => hover.sec >= m.start && hover.sec < m.end)?.label : undefined

  return (
    <div
      ref={ref}
      className={`pl-timeline ${drag ? 'dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Posición"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${fmtTime(time)} de ${fmtTime(total)}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || !total) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const h = at(e.clientX)
        setDrag(true)
        onScrub(true)
        setHover(h)
        onSeek(h.sec)
      }}
      onPointerMove={(e) => {
        const h = at(e.clientX)
        setHover(h)
        if (drag) onSeek(h.sec)
      }}
      onPointerUp={() => {
        setDrag(false)
        onScrub(false)
      }}
      onPointerCancel={() => {
        setDrag(false)
        onScrub(false)
      }}
      onPointerLeave={() => !drag && setHover(null)}
    >
      <div className="pl-track">
        {buffered.map(([s, e], i) => (
          <span key={i} className="pl-buffered" style={{ left: pct(s, total), width: pct(e - s, total) }} />
        ))}
        {hover && <span className="pl-ghost" style={{ width: hover.x }} />}
        <span className="pl-played" style={{ width: pct(time, total) }} />
      </div>
      <Strip marks={marks} total={total} />
      <span className="pl-thumb" style={{ left: pct(time, total) }} />
      {hover && (
        <span className="pl-tip" style={{ left: clamp(hover.x, 30, Math.max(30, hover.w - 30)) }}>
          {fmtTime(hover.sec)}
          {speaker && <em>{speaker}</em>}
        </span>
      )}
    </div>
  )
}

/** Franja con los turnos de palabra, del color de cada persona. */
const Strip = memo(function Strip({ marks, total }: { marks: PlayerMark[]; total: number }): React.JSX.Element | null {
  if (!marks.length || !total) return null
  return (
    <div className="pl-strip" aria-hidden>
      {marks.map((m, i) => (
        <span key={i} style={{ left: pct(m.start, total), width: pct(m.end - m.start, total), background: m.color }} />
      ))}
    </div>
  )
})

// ---------------- deslizador (volumen) ----------------

function Slider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const at = (clientX: number): number => {
    const r = ref.current!.getBoundingClientRect()
    return r.width ? clamp((clientX - r.left) / r.width, 0, 1) : 0
  }
  return (
    <div
      ref={ref}
      className="pl-slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag(true)
        onChange(at(e.clientX))
      }}
      onPointerMove={(e) => drag && onChange(at(e.clientX))}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0
        if (!step) return
        e.preventDefault()
        e.stopPropagation()
        onChange(clamp(value + step, 0, 1))
      }}
    >
      <span className="pl-slider-track">
        <span className="pl-slider-fill" style={{ width: `${value * 100}%` }} />
      </span>
      <span className="pl-slider-thumb" style={{ left: `${value * 100}%` }} />
    </div>
  )
}
