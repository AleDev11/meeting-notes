import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Maximize, Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { fmtTime } from '../util'

export interface PlayerHandle {
  /** Salta a un segundo concreto y empieza a reproducir. */
  playFrom: (sec: number) => void
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75]
/** Desfase máximo entre el audio y el vídeo antes de corregirlo. */
const DRIFT = 0.35

/**
 * Reproductor de la grabación completa. El audio manda y, si se grabó la pantalla, el
 * vídeo lo sigue (sin sonido): así cuadran aunque la pantalla empezara a mitad de
 * reunión (videoOffset). La duración de lo grabado con MediaRecorder no siempre viene
 * en el fichero, así que se usa la de la reunión.
 */
export const AudioPlayer = forwardRef<
  PlayerHandle,
  { src: string; video?: string; videoOffset?: number; duration: number; onTime: (sec: number | null) => void }
>(function AudioPlayer({ src, video, videoOffset = 0, duration, onTime }, ref) {
  const audio = useRef<HTMLAudioElement>(null)
  const screen = useRef<HTMLVideoElement>(null)
  const [showVideo, setShowVideo] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [speed, setSpeed] = useState(1)

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
    a.currentTime = Math.max(0, Math.min(sec, total() || sec))
    setTime(a.currentTime)
    sync()
  }

  useImperativeHandle(ref, () => ({
    playFrom: (sec) => {
      seek(sec)
      void audio.current?.play()
    }
  }))

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
    if (screen.current) screen.current.playbackRate = speed
  }, [speed])

  useEffect(() => () => onTime(null), [onTime])

  const len = total()
  const beforeVideo = !!video && time < videoOffset
  return (
    <div className={`player-wrap ${video && showVideo ? 'with-video' : ''}`}>
      {video && (
        <div className="player-screen">
          <video
            ref={screen}
            src={video}
            muted
            preload="metadata"
            className="player-video"
            onDoubleClick={() => void screen.current?.requestFullscreen()}
          />
          {beforeVideo && <span className="player-screen-note">La pantalla empieza en {fmtTime(videoOffset)}</span>}
        </div>
      )}
      <div className="player">
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
            onTime(null)
            sync()
          }}
          onEnded={() => {
            setPlaying(false)
            onTime(null)
          }}
          onSeeked={sync}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime
            setTime(t)
            if (!e.currentTarget.paused) onTime(t)
            sync()
          }}
        />
        <button className="icon-btn" onClick={() => seek(time - 5)} title="Atrás 5 s" aria-label="Atrás 5 segundos">
          <RotateCcw size={14} />
        </button>
        <button
          className="player-play"
          onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
          aria-label={playing ? 'Pausar' : 'Reproducir'}
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <button className="icon-btn" onClick={() => seek(time + 5)} title="Adelante 5 s" aria-label="Adelante 5 segundos">
          <RotateCw size={14} />
        </button>
        <span className="player-time">{fmtTime(time)}</span>
        <input
          className="player-seek"
          type="range"
          min={0}
          max={len || 1}
          step={0.1}
          value={Math.min(time, len || 1)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Posición"
          style={{ '--p': `${len ? (time / len) * 100 : 0}%` } as React.CSSProperties}
        />
        <span className="player-time">{fmtTime(len)}</span>
        <button
          className="player-speed"
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          title="Velocidad de reproducción"
        >
          {speed}×
        </button>
        {video && (
          <>
            <button
              className="icon-btn"
              onClick={() => void screen.current?.requestFullscreen()}
              title="Ver el vídeo a pantalla completa"
              aria-label="Pantalla completa"
            >
              <Maximize size={14} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setShowVideo(!showVideo)}
              title={showVideo ? 'Ocultar el vídeo' : 'Mostrar el vídeo'}
              aria-label={showVideo ? 'Ocultar el vídeo' : 'Mostrar el vídeo'}
            >
              {showVideo ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </>
        )}
      </div>
    </div>
  )
})
