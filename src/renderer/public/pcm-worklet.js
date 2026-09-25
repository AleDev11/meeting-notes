// Convierte el audio de entrada (Float32 a la frecuencia del AudioContext)
// en PCM16 mono a 16 kHz y lo envía en bloques de ~100 ms junto a su nivel (RMS).
const TARGET_RATE = 16000
const CHUNK_SAMPLES = TARGET_RATE / 10

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / TARGET_RATE
    this.pos = 0
    this.buffer = new Int16Array(CHUNK_SAMPLES)
    this.filled = 0
    this.sumSq = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const frames = input[0].length
    for (; this.pos < frames; this.pos += this.ratio) {
      const i = Math.floor(this.pos)
      let v = 0
      for (let c = 0; c < input.length; c++) v += input[c][i]
      v = Math.max(-1, Math.min(1, v / input.length))
      this.sumSq += v * v
      this.buffer[this.filled++] = v < 0 ? v * 0x8000 : v * 0x7fff
      if (this.filled === CHUNK_SAMPLES) {
        const level = Math.sqrt(this.sumSq / CHUNK_SAMPLES)
        this.port.postMessage({ pcm: this.buffer.buffer, level }, [this.buffer.buffer])
        this.buffer = new Int16Array(CHUNK_SAMPLES)
        this.filled = 0
        this.sumSq = 0
      }
    }
    this.pos -= frames
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
