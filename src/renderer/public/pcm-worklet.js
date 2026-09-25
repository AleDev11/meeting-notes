// Convierte el audio de entrada (Float32 a la frecuencia del AudioContext)
// en PCM16 mono a 16 kHz y lo envía en bloques de ~100 ms junto a su nivel (RMS).
// Cada muestra de salida es la media de las de entrada que le corresponden: un
// filtro paso bajo sencillo que evita el aliasing de quedarse con una de cada tres.
const TARGET_RATE = 16000
const CHUNK_SAMPLES = TARGET_RATE / 10

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / TARGET_RATE
    this.phase = 0
    this.acc = 0
    this.count = 0
    this.buffer = new Int16Array(CHUNK_SAMPLES)
    this.filled = 0
    this.sumSq = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const frames = input[0].length
    for (let i = 0; i < frames; i++) {
      let v = 0
      for (let c = 0; c < input.length; c++) v += input[c][i]
      this.acc += v / input.length
      this.count++
      this.phase++
      if (this.phase < this.ratio) continue
      this.phase -= this.ratio

      const out = Math.max(-1, Math.min(1, this.acc / this.count))
      this.acc = 0
      this.count = 0
      this.sumSq += out * out
      this.buffer[this.filled++] = out < 0 ? out * 0x8000 : out * 0x7fff
      if (this.filled === CHUNK_SAMPLES) {
        const level = Math.sqrt(this.sumSq / CHUNK_SAMPLES)
        this.port.postMessage({ pcm: this.buffer.buffer, level }, [this.buffer.buffer])
        this.buffer = new Int16Array(CHUNK_SAMPLES)
        this.filled = 0
        this.sumSq = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
