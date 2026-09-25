import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { fmtTime } from '../util'

export interface PlayerHandle {
  /** Salta a un segundo concreto y empieza a reproducir. */
  playFrom: (sec: number) => void
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75]

/**
 * Reproductor de la grabación completa. La duración de un WebM grabado con
 * MediaRecorder no siempre viene en el fichero, así que se usa la de la reunión.
 */
export const AudioPlayer = forwardRef<
  PlayerHandle,
  { src: string; duration: number; onTime: (sec: number | null) => void }
>(function AudioPlayer({ src, duration, onTime }, ref) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [speed, setSpeed] = useState(1)

  const total = (): number => {
    const d = audio.current?.duration
    return d && Number.isFinite(d) ? d : duration
  }
  const seek = (sec: number): void => {
    const a = audio.current
    if (!a) return
    a.currentTime = Math.max(0, Math.min(sec, total() || sec))
    setTime(a.currentTime)
  }

  useImperativeHandle(ref, () => ({
    playFrom: (sec) => {
      seek(sec)
      void audio.current?.play()
    }
  }))

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
  }, [speed])

  useEffect(() => () => onTime(null), [onTime])

  const len = total()
  return (
    <div className="player">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          onTime(null)
        }}
        onEnded={() => {
          setPlaying(false)
          onTime(null)
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime
          setTime(t)
          if (!e.currentTarget.paused) onTime(t)
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
    </div>
  )
})
