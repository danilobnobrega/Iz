// Som da V, todo sintetizado (nenhum arquivo de áudio). Começa mudo. Cada lugar tem um ambiente
// que sobe e desce com o peso dele na tela; os gestos têm sons curtos e discretos.

type Amb = { gain: GainNode; level: number; dyn: number }

export class Sound {
  ctx: AudioContext | null = null
  master: GainNode | null = null
  on = false
  amb = new Map<string, Amb>()
  weights = new Map<string, number>()
  lastTick = 0
  dyn = new Map<string, number>()

  private init() {
    if (this.ctx) return
    const ctx = new AudioContext()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(comp).connect(ctx.destination)
    this.buildAmbients()
  }

  toggle() {
    this.init()
    const ctx = this.ctx!
    if (ctx.state === 'suspended') ctx.resume()
    this.on = !this.on
    this.master!.gain.setTargetAtTime(this.on ? 0.9 : 0, ctx.currentTime, 0.35)
  }

  noise(seconds = 4, kind: 'white' | 'brown' | 'pink' = 'white') {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    let b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046
        b1 = 0.963 * b1 + w * 0.2965164
        b2 = 0.57 * b2 + w * 1.0526913
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
      } else d[i] = w
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    return src
  }

  private ambient(name: string, level: number, build: (out: GainNode) => void) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    g.gain.value = 0
    g.connect(this.master!)
    build(g)
    this.amb.set(name, { gain: g, level, dyn: 1 })
  }

  private buildAmbients() {
    const ctx = this.ctx!
    // chegada: pedra e calor, um zumbido grave que respira
    this.ambient('marca', 0.32, (out) => {
      const n = this.noise(6, 'brown')
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 260
      n.connect(lp).connect(out)
      n.start()
      ;[55, 82.41, 110.3].forEach((f, i) => {
        const o = ctx.createOscillator()
        o.type = i === 1 ? 'triangle' : 'sine'
        o.frequency.value = f
        o.detune.value = (i - 1) * 4
        const g = ctx.createGain()
        g.gain.value = [0.05, 0.022, 0.012][i]
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.07 + i * 0.031
        const lg = ctx.createGain()
        lg.gain.value = g.gain.value * 0.6
        lfo.connect(lg).connect(g.gain)
        o.connect(g).connect(out)
        o.start()
        lfo.start()
      })
    })
    // vitrine: ar de sala silenciosa e um acorde de vidro muito baixo
    this.ambient('vitrine', 0.26, (out) => {
      const n = this.noise(5, 'pink')
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1800
      bp.Q.value = 0.6
      const g = ctx.createGain()
      g.gain.value = 0.18
      n.connect(bp).connect(g).connect(out)
      n.start()
      ;[523.25, 784.0, 1174.7].forEach((f, i) => {
        const o = ctx.createOscillator()
        o.frequency.value = f
        const og = ctx.createGain()
        og.gain.value = 0.006 / (i + 1)
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.11 + i * 0.07
        const lg = ctx.createGain()
        lg.gain.value = og.gain.value
        lfo.connect(lg).connect(og.gain)
        o.connect(og).connect(out)
        o.start()
        lfo.start()
      })
    })
    // passagem: vento que muda com a velocidade
    this.ambient('passagem', 0.4, (out) => {
      const n = this.noise(5, 'white')
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 500
      bp.Q.value = 1.4
      ;(this as any).windFilter = bp
      const g = ctx.createGain()
      g.gain.value = 0.22
      n.connect(bp).connect(g).connect(out)
      n.start()
    })
    // contato: pó em movimento
    this.ambient('contato', 0.3, (out) => {
      const n = this.noise(5, 'white')
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 5200
      const g = ctx.createGain()
      g.gain.value = 0.09
      n.connect(hp).connect(g).connect(out)
      n.start()
      const o = ctx.createOscillator()
      o.frequency.value = 73.4
      const og = ctx.createGain()
      og.gain.value = 0.03
      o.connect(og).connect(out)
      o.start()
    })
  }

  setPlace(a: string, wa: number, b: string, wb: number) {
    this.weights.clear()
    this.weights.set(a, wa)
    if (b) this.weights.set(b, wb)
  }

  // intensidade dinâmica de um ambiente (0..1), ex.: o vento com a velocidade
  setDyn(name: string, v: number) {
    this.dyn.set(name, v)
  }

  tick(_dt: number, vel: number) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime
    this.amb.forEach((a, name) => {
      const w = this.weights.get(name) ?? 0
      const d = this.dyn.get(name) ?? 1
      a.gain.gain.setTargetAtTime(a.level * w * d, t, 0.25)
    })
    const wf = (this as any).windFilter as BiquadFilterNode | undefined
    if (wf) wf.frequency.setTargetAtTime(380 + Math.min(Math.abs(vel), 3) * 900, t, 0.2)
  }

  // ---- eventos curtos ----
  private env(dur: number, peak: number) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    g.connect(this.master!)
    return g
  }

  beep(min = 0.4) {
    if (!this.ctx || !this.on) return
    const now = this.ctx.currentTime
    if (now - this.lastTick < min) return
    this.lastTick = now
    const f = [1760, 2093, 2637][Math.floor(Math.random() * 3)]
    const o = this.ctx.createOscillator()
    o.type = 'square'
    o.frequency.value = f
    const lp = this.ctx.createBiquadFilter()
    lp.frequency.value = 3200
    o.connect(lp).connect(this.env(0.05, 0.03))
    o.start()
    o.stop(now + 0.06)
  }

  // vidro: parciais inarmônicas de um bloco maciço
  glass(pitch = 1, amt = 1) {
    if (!this.ctx || !this.on) return
    const now = this.ctx.currentTime
    ;[1, 2.76, 5.4, 8.93].forEach((m, i) => {
      const o = this.ctx!.createOscillator()
      o.frequency.value = 880 * pitch * m
      o.connect(this.env(1.6 / (i + 1), (0.05 * amt) / (i + 1.5)))
      o.start()
      o.stop(now + 1.7)
    })
  }

  // sopro / passagem de ar
  whoosh(dur = 0.9, amt = 1, from = 300, to = 2400) {
    if (!this.ctx || !this.on) return
    const now = this.ctx.currentTime
    const n = this.noise(2, 'white')
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    bp.frequency.setValueAtTime(from, now)
    bp.frequency.exponentialRampToValueAtTime(to, now + dur * 0.6)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.18 * amt, now + dur * 0.35)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    n.connect(bp).connect(g).connect(this.master!)
    n.start()
    n.stop(now + dur + 0.05)
  }

  // pedra: estalo seco e grave
  stone(amt = 1) {
    if (!this.ctx || !this.on) return
    const now = this.ctx.currentTime
    const n = this.noise(0.3, 'brown')
    const lp = this.ctx.createBiquadFilter()
    lp.frequency.value = 900
    n.connect(lp).connect(this.env(0.12, 0.25 * amt))
    n.start()
    n.stop(now + 0.15)
  }
}
