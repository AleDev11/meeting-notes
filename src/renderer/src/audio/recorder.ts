import type { AudioChannel, RecordingTrack } from '@shared/types'

export interface CapturePlan {
  meetingId: string
  mic: boolean
  system: boolean
  micDeviceId: string
  /** Transcribir el micrófono aparte (siempre "yo") y el sistema aparte. */
  separate: boolean
  /** Grabar también la pantalla elegida (screen.mp4, con el audio mezclado). */
  screen: boolean
}

/** Formatos de vídeo por orden de preferencia: MP4/H.264 se abre en cualquier reproductor. */
const VIDEO_TYPES = ['video/mp4;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus']

/** Qué canales se transcriben en vivo según lo que se captura. */
export function channelsFor(p: Pick<CapturePlan, 'mic' | 'system' | 'separate'>): AudioChannel[] {
  if (p.mic && p.system && p.separate) return ['mic', 'system']
  return ['mix']
}

export type Levels = Partial<Record<'mic' | 'system', number>>
export type Source = 'mic' | 'system'

/**
 * Captura micrófono y/o audio del sistema (cualquier app: Teams, Meet, Discord, Zoom...).
 *  - Envía PCM16 16 kHz por canal al proceso principal para la transcripción en vivo.
 *  - Graba la mezcla en WebM/Opus para escucharla después y, si se separan las fuentes,
 *    también cada fuente por su lado para que la pasada final no tenga que adivinar
 *    qué voz es la tuya.
 */
export class MeetingRecorder {
  private ctx: AudioContext | null = null
  private streams: MediaStream[] = []
  private sources: Partial<Record<Source, MediaStream>> = {}
  private recorders: MediaRecorder[] = []
  private levels: Levels = {}
  private paused = false
  private activeMs = 0
  private resumedAt = 0

  constructor(private onLevels?: (l: Levels) => void) {}

  async start(p: CapturePlan): Promise<void> {
    if (!p.mic && !p.system) throw new Error('Activa al menos el micrófono o el audio del sistema.')

    let systemStream: MediaStream | null = null
    let micStream: MediaStream | null = null
    let screenTrack: MediaStreamTrack | null = null
    if (p.system || p.screen) {
      // El proceso principal entrega la pantalla elegida y el audio de todo el equipo.
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      this.streams.push(display)
      for (const t of display.getVideoTracks()) {
        if (p.screen && !screenTrack) {
          screenTrack = t
          // Para reuniones y presentaciones bastan 10 imágenes por segundo a 1080p como mucho.
          await t.applyConstraints({ frameRate: { max: 10 }, width: { max: 1920 }, height: { max: 1080 } }).catch(() => {})
        } else {
          t.stop()
          display.removeTrack(t)
        }
      }
      if (p.system) {
        if (display.getAudioTracks().length === 0) throw new Error('No se pudo capturar el audio del sistema.')
        systemStream = new MediaStream(display.getAudioTracks())
        this.sources.system = systemStream
      } else {
        display.getAudioTracks().forEach((t) => t.stop())
      }
    }
    if (p.mic) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: p.micDeviceId ? { exact: p.micDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      this.streams.push(micStream)
      this.sources.mic = micStream
    }

    const ctx = new AudioContext({ sampleRate: 48000 })
    this.ctx = ctx
    await ctx.audioWorklet.addModule('./pcm-worklet.js')
    const sink = ctx.createGain()
    sink.gain.value = 0
    sink.connect(ctx.destination)
    const mix = ctx.createMediaStreamDestination()

    const worklet = (onChunk: (pcm: Uint8Array, level: number) => void): AudioWorkletNode => {
      const node = new AudioWorkletNode(ctx, 'pcm-processor', { channelCount: 1 })
      node.connect(sink)
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) =>
        onChunk(new Uint8Array(e.data.pcm), e.data.level)
      return node
    }
    const report = (key: Source, level: number): void => {
      this.levels = { ...this.levels, [key]: Math.min(1, level * 4) }
      this.onLevels?.(this.levels)
    }
    const send = (channel: AudioChannel, pcm: Uint8Array): void => {
      if (!this.paused) window.api.sendPcm(channel, pcm)
    }

    const micSrc = micStream && ctx.createMediaStreamSource(micStream)
    const sysSrc = systemStream && ctx.createMediaStreamSource(systemStream)
    micSrc?.connect(mix)
    sysSrc?.connect(mix)

    const separate = channelsFor(p).includes('mic')
    if (!separate) {
      const mixNode = worklet((pcm) => send('mix', pcm))
      micSrc?.connect(mixNode)
      sysSrc?.connect(mixNode)
      // Medidores independientes aunque se transcriba la mezcla.
      micSrc?.connect(worklet((_pcm, l) => report('mic', l)))
      sysSrc?.connect(worklet((_pcm, l) => report('system', l)))
    } else {
      micSrc!.connect(
        worklet((pcm, l) => {
          send('mic', pcm)
          report('mic', l)
        })
      )
      sysSrc!.connect(
        worklet((pcm, l) => {
          send('system', pcm)
          report('system', l)
        })
      )
    }

    this.record(p.meetingId, 'mix', mix.stream, 64000)
    if (separate) {
      this.record(p.meetingId, 'mic', micStream!, 32000)
      this.record(p.meetingId, 'system', systemStream!, 32000)
    }
    if (screenTrack) {
      const video = new MediaStream([screenTrack, ...mix.stream.getAudioTracks()])
      const mimeType = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
      this.record(p.meetingId, 'screen', video, 64000, { mimeType, videoBitsPerSecond: 1_500_000 })
    }
    this.resumedAt = Date.now()
  }

  private record(
    meetingId: string,
    track: RecordingTrack,
    stream: MediaStream,
    bitrate: number,
    video?: { mimeType?: string; videoBitsPerSecond: number }
  ): void {
    const rec = new MediaRecorder(stream, {
      mimeType: video ? video.mimeType : 'audio/webm;codecs=opus',
      audioBitsPerSecond: bitrate,
      ...(video && { videoBitsPerSecond: video.videoBitsPerSecond })
    })
    rec.ondataavailable = async (e) => {
      if (e.data.size > 0) window.api.sendWebm(meetingId, track, new Uint8Array(await e.data.arrayBuffer()))
    }
    rec.start(5000)
    this.recorders.push(rec)
  }

  /**
   * Silencia una fuente sin cortar la grabación: se sigue grabando silencio para que
   * los tiempos de la transcripción y del audio sigan cuadrando.
   */
  setMuted(source: Source, muted: boolean): void {
    this.sources[source]?.getAudioTracks().forEach((t) => (t.enabled = !muted))
  }

  /** Pausa la grabación: lo que suene mientras tanto no se graba ni se transcribe. */
  pause(): void {
    if (this.paused) return
    this.paused = true
    this.activeMs += Date.now() - this.resumedAt
    this.recorders.forEach((r) => r.state === 'recording' && r.pause())
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.resumedAt = Date.now()
    this.recorders.forEach((r) => r.state === 'paused' && r.resume())
  }

  /** Segundos grabados, sin contar las pausas. */
  get elapsed(): number {
    const ms = this.activeMs + (this.paused || !this.resumedAt ? 0 : Date.now() - this.resumedAt)
    return Math.round(ms / 1000)
  }

  /** Detiene todo y devuelve la duración grabada en segundos. */
  async stop(): Promise<number> {
    const duration = this.elapsed
    await Promise.all(
      this.recorders
        .filter((r) => r.state !== 'inactive')
        .map(
          (r) =>
            new Promise<void>((resolve) => {
              // El último ondataavailable llega antes que onstop, pero su arrayBuffer()
              // es asíncrono: margen para que se envíe.
              r.onstop = () => setTimeout(resolve, 300)
              r.stop()
            })
        )
    )
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    this.streams = []
    this.sources = {}
    await this.ctx?.close()
    this.ctx = null
    this.recorders = []
    return duration
  }
}
