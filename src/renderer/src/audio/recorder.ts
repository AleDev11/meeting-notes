import type { AudioChannel } from '@shared/types'

export interface CapturePlan {
  meetingId: string
  mic: boolean
  system: boolean
  micDeviceId: string
  /** Transcribir el micrófono aparte (siempre "yo") y el sistema aparte. */
  separate: boolean
}

/** Qué canales se transcriben en vivo según lo que se captura. */
export function channelsFor(p: Pick<CapturePlan, 'mic' | 'system' | 'separate'>): AudioChannel[] {
  if (p.mic && p.system && p.separate) return ['mic', 'system']
  return ['mix']
}

export type Levels = Partial<Record<'mic' | 'system', number>>

/**
 * Captura micrófono y/o audio del sistema (cualquier app: Teams, Meet, Discord, Zoom...).
 *  - Envía PCM16 16 kHz por canal al proceso principal para la transcripción en vivo.
 *  - Graba la mezcla en WebM/Opus para la transcripción final con hablantes.
 */
export class MeetingRecorder {
  private ctx: AudioContext | null = null
  private streams: MediaStream[] = []
  private recorder: MediaRecorder | null = null
  private startedAt = 0
  private levels: Levels = {}

  constructor(private onLevels?: (l: Levels) => void) {}

  async start(p: CapturePlan): Promise<void> {
    if (!p.mic && !p.system) throw new Error('Activa al menos el micrófono o el audio del sistema.')

    let systemStream: MediaStream | null = null
    let micStream: MediaStream | null = null
    if (p.system) {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      display.getVideoTracks().forEach((t) => {
        t.stop()
        display.removeTrack(t)
      })
      this.streams.push(display)
      if (display.getAudioTracks().length === 0) {
        throw new Error('No se pudo capturar el audio del sistema.')
      }
      systemStream = display
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
    const report = (key: 'mic' | 'system', level: number): void => {
      this.levels = { ...this.levels, [key]: Math.min(1, level * 4) }
      this.onLevels?.(this.levels)
    }

    const micSrc = micStream && ctx.createMediaStreamSource(micStream)
    const sysSrc = systemStream && ctx.createMediaStreamSource(systemStream)
    micSrc?.connect(mix)
    sysSrc?.connect(mix)

    if (channelsFor(p).includes('mix')) {
      const mixNode = worklet((pcm) => window.api.sendPcm('mix', pcm))
      micSrc?.connect(mixNode)
      sysSrc?.connect(mixNode)
      // Medidores independientes aunque se transcriba la mezcla.
      micSrc?.connect(worklet((_pcm, l) => report('mic', l)))
      sysSrc?.connect(worklet((_pcm, l) => report('system', l)))
    } else {
      micSrc!.connect(
        worklet((pcm, l) => {
          window.api.sendPcm('mic', pcm)
          report('mic', l)
        })
      )
      sysSrc!.connect(
        worklet((pcm, l) => {
          window.api.sendPcm('system', pcm)
          report('system', l)
        })
      )
    }

    this.recorder = new MediaRecorder(mix.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 64000
    })
    this.recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        window.api.sendWebm(p.meetingId, new Uint8Array(await e.data.arrayBuffer()))
      }
    }
    this.recorder.start(5000)
    this.startedAt = Date.now()
  }

  /** Detiene todo y devuelve la duración en segundos. */
  async stop(): Promise<number> {
    const rec = this.recorder
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        // El último ondataavailable llega antes que onstop, pero su arrayBuffer()
        // es asíncrono: margen para que se envíe.
        rec.onstop = () => setTimeout(resolve, 300)
        rec.stop()
      })
    }
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    this.streams = []
    await this.ctx?.close()
    this.ctx = null
    this.recorder = null
    return this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0
  }
}
