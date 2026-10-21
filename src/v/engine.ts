import * as THREE from 'three'
import { Overlay, Label } from './type'
import { Bloom, Cut, Final, quad, rt } from './post'
import { clamp, damp, fit } from './util'
import type { Sound } from './sound'

// Motor da V. A rolagem é própria (roda, toque, teclado) e dá a volta: depois do último lugar,
// o primeiro. Entre dois lugares há uma faixa em que os dois são desenhados e costurados pelo
// corte de vidro. Parado por 1,4 s, o site se acomoda no lugar inteiro mais próximo.

export type Pointer = {
  x: number // ndc
  y: number
  px: number // pixels css
  py: number
  vx: number // px/s
  vy: number
  speed: number
  down: boolean
  inside: boolean
  moved: number // tempo desde o último movimento
}

export type Frame = {
  t: number
  dt: number
  vel: number // velocidade da rolagem em unidades/s
  vis: number // peso deste lugar na tela (0..1)
  w: number
  h: number
  dpr: number
  pointer: Pointer
  ov: Overlay
  sound: Sound
  engine: Engine
}

export interface Place {
  name: string
  length: number
  stops: number[] // posições locais onde a rolagem pode descansar
  rt: THREE.WebGLRenderTarget
  bloom: number // limiar
  bloomStrength: number
  resize(w: number, h: number, dpr: number): void
  update(local: number, f: Frame): void
  render(r: THREE.WebGLRenderer, f: Frame): void
  hide(): void
  click?(f: Frame): boolean
  key?(k: string, f: Frame): boolean
  hover?(f: Frame): boolean // cursor de "clicável"
  captureScroll?(): boolean // um lugar pode tomar a rolagem (página interna de uma casa)
  scroll?(dy: number): void
}

const BAND = 0.9

export class Engine {
  r: THREE.WebGLRenderer
  ov = new Overlay()
  cut = new Cut()
  bloom = new Bloom(6)
  final = new Final()
  mix = rt(2, 2)
  places: Place[] = []
  starts: number[] = []
  total = 0
  target = 0
  pos = 0
  smooth1 = 0
  vel = 0
  lastInput = -10
  t = 0
  w = 1
  h = 1
  dpr = 1
  maxDpr = Math.min(window.devicePixelRatio || 1, 1.75)
  inputOn = false
  pointer: Pointer = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0, down: false, inside: false, moved: 99 }
  frameCb: ((f: Frame) => void)[] = []
  fps = { acc: 0, n: 0, changes: 0, wait: 2 }
  touchY = 0
  logo: Label
  soundLabel: Label
  sign: Label

  constructor(public canvas: HTMLCanvasElement, public sound: Sound) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.r.setClearColor(0x0c0b0a, 1)
    this.r.autoClear = true
    this.dpr = this.maxDpr
    this.logo = new Label(this.ov, 'Íz', { font: 'serif', size: 34, spacing: 0, lineHeight: 1, dur: 0.9, spread: 0.6 })
    this.soundLabel = new Label(this.ov, 'Som: desligado', { size: 10.5, spacing: 0.6, dur: 0.5 })
    this.sign = new Label(this.ov, '// Proposta não oficial · Danilo · 2026', { size: 10.5, spacing: 0.6, align: 'right', dur: 0.8 })
    this.bind()
    this.resize()
  }

  add(p: Place) {
    this.places.push(p)
    this.layout()
  }

  layout() {
    this.starts = []
    let s = 0
    for (const p of this.places) {
      this.starts.push(s)
      s += p.length + BAND
    }
    this.total = s
  }

  get stops() {
    const out: number[] = []
    this.places.forEach((p, i) => p.stops.forEach((st) => out.push(this.starts[i] + st)))
    return out
  }

  resize() {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.r.setPixelRatio(this.dpr)
    this.r.setSize(this.w, this.h, false)
    this.canvas.style.width = this.w + 'px'
    this.canvas.style.height = this.h + 'px'
    const W = Math.round(this.w * this.dpr)
    const H = Math.round(this.h * this.dpr)
    this.mix.setSize(W, H)
    this.bloom.resize(W, H)
    this.final.mat.uniforms.uRes.value.set(W, H)
    this.ov.resize(this.w, this.h, this.dpr)
    this.places.forEach((p) => p.resize(this.w, this.h, this.dpr))
  }

  bind() {
    addEventListener('resize', () => this.resize())
    addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        if (!this.inputOn) return
        let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1)
        dy = clamp(dy, -160, 160)
        this.input(dy)
      },
      { passive: false },
    )
    const setPointer = (x: number, y: number) => {
      const p = this.pointer
      const now = performance.now() / 1000
      const dt = Math.max(1 / 240, now - (p as any)._t || 1 / 60)
      ;(p as any)._t = now
      p.vx = p.vx * 0.6 + ((x - p.px) / dt) * 0.4
      p.vy = p.vy * 0.6 + ((y - p.py) / dt) * 0.4
      p.px = x
      p.py = y
      p.x = (x / this.w) * 2 - 1
      p.y = -(y / this.h) * 2 + 1
      p.inside = true
      p.moved = 0
    }
    addEventListener('pointermove', (e) => setPointer(e.clientX, e.clientY))
    addEventListener('pointerdown', (e) => {
      setPointer(e.clientX, e.clientY)
      this.pointer.down = true
      this.touchY = e.clientY
    })
    addEventListener('pointerup', (e) => {
      this.pointer.down = false
      if (e.pointerType !== 'mouse' && Math.abs(e.clientY - this.touchY) > 12) return
      this.click()
    })
    document.addEventListener('pointerleave', () => (this.pointer.inside = false))
    addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault()
        const y = e.touches[0].clientY
        if (this.inputOn) this.input((this.touchY - y) * 2.2)
        this.touchY = y
      },
      { passive: false },
    )
    addEventListener('keydown', (e) => {
      if (!this.inputOn) return
      const cur = this.focus()
      const f = this.frame(cur, 1)
      if (cur.key?.(e.key, f)) return
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') this.jump(1)
      if (e.key === 'ArrowUp' || e.key === 'PageUp') this.jump(-1)
    })
  }

  input(dy: number) {
    const cur = this.focus()
    if (cur.captureScroll?.()) {
      cur.scroll?.(dy)
      return
    }
    this.target += dy * 0.0017
    this.lastInput = this.t
  }

  // vai para a próxima parada (teclado)
  jump(dir: number) {
    const all = this.stops
    const L = this.total
    let best = this.target + dir * 0.5
    let bd = Infinity
    for (let k = -1; k <= 1; k++)
      for (const s of all) {
        const c = s + Math.round(this.target / L + k) * L
        const d = (c - this.target) * dir
        if (d > 0.05 && d < bd) {
          bd = d
          best = c
        }
      }
    this.target = best
    this.lastInput = this.t
  }

  click() {
    if (!this.inputOn) return
    const p = this.pointer
    // som: canto inferior esquerdo
    if (p.px < this.soundLabel.x + this.soundLabel.width + 16 && p.py > this.soundLabel.y - 12 && p.py < this.soundLabel.y + 30) {
      this.sound.toggle()
      this.soundLabel.replay(this.sound.on ? 'Som: ligado' : 'Som: desligado')
      return
    }
    const cur = this.focus()
    cur.click?.(this.frame(cur, 1))
  }

  // o lugar que domina a tela (recebe clique, teclado e rolagem interna)
  focus() {
    const c = this.current()
    return c.next && c.mix > 0.5 ? c.next : c.place
  }

  // que lugar(es) estão na tela
  current() {
    const L = this.total
    const m = ((this.pos % L) + L) % L
    for (let i = 0; i < this.places.length; i++) {
      const s = this.starts[i]
      const p = this.places[i]
      const e = s + p.length
      if (m >= s && m < e) return { place: p, i, local: m - s, next: null as Place | null, nl: 0, mix: 0 }
      if (m >= e && m < e + BAND) {
        const j = (i + 1) % this.places.length
        const ns = j === 0 ? L : this.starts[j]
        const raw = (m - e) / BAND
        // nas pontas da faixa, só um lugar é desenhado
        if (raw > 0.985) return { place: this.places[j], i: j, local: m - ns, next: null as Place | null, nl: 0, mix: 0 }
        if (raw < 0.015) return { place: p, i, local: m - s, next: null as Place | null, nl: 0, mix: 0 }
        return { place: p, i, local: m - s, next: this.places[j], nl: m - ns, mix: raw }
      }
    }
    return { place: this.places[0], i: 0, local: 0, next: null, nl: 0, mix: 0 }
  }

  frame(_p: Place, vis: number, dt = 1 / 60): Frame {
    return {
      t: this.t,
      dt,
      vel: this.vel,
      vis,
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      pointer: this.pointer,
      ov: this.ov,
      sound: this.sound,
      engine: this,
    }
  }

  step(dt: number) {
    dt = clamp(dt, 0, 1 / 20)
    this.t += dt
    this.pointer.moved += dt
    this.pointer.speed = Math.hypot(this.pointer.vx, this.pointer.vy)
    this.pointer.vx *= Math.pow(0.0001, dt)
    this.pointer.vy *= Math.pow(0.0001, dt)

    // acomodação automática
    if (this.inputOn && this.t - this.lastInput > 1.4 && !this.focus().captureScroll?.()) {
      const L = this.total
      let best = this.target
      let bd = Infinity
      for (const s of this.stops)
        for (let k = -1; k <= 1; k++) {
          const c = s + (Math.floor(this.target / L) + k) * L
          const d = Math.abs(c - this.target)
          if (d < bd) {
            bd = d
            best = c
          }
        }
      this.target += (best - this.target) * damp(0.06, dt)
    }
    // duas camadas de suavização: a rolagem tem peso
    const prev = this.pos
    this.smooth1 += (this.target - this.smooth1) * damp(0.12, dt)
    this.pos += (this.smooth1 - this.pos) * damp(0.1, dt)
    const v = (this.pos - prev) / dt
    this.vel += (v - this.vel) * damp(0.15, dt)

    this.adaptDpr(dt)

    const cur = this.current()
    const visA = cur.next ? 1 - fit(cur.mix, 0.3, 0.7) : 1
    const fA = this.frame(cur.place, visA, dt)
    cur.place.update(cur.local, fA)
    let fB: Frame | null = null
    if (cur.next) {
      fB = this.frame(cur.next, 1 - visA, dt)
      cur.next.update(cur.nl, fB)
    }
    for (const p of this.places) if (p !== cur.place && p !== cur.next) p.hide()
    for (const cb of this.frameCb) cb(fA)

    // moldura
    const m = this.w < 760 ? 24 : 48
    this.logo.place(m, 36)
    this.soundLabel.place(m, this.h - 44)
    this.sign.set(this.w < 760 ? '// Proposta não oficial' : '// Proposta não oficial · Danilo · 2026')
    this.sign.place(this.w - m, this.h - 44)
    this.ov.update(dt)
    const fp = this.focus()
    const hov = fp.hover?.(fp === cur.place ? fA : fB ?? fA) ?? false
    this.canvas.style.cursor = hov ? 'pointer' : 'default'

    this.sound.setPlace(cur.place.name, visA, cur.next?.name ?? '', 1 - visA)
    this.sound.tick(dt, this.vel)

    // desenho
    const r = this.r
    cur.place.render(r, fA)
    let src: THREE.Texture = cur.place.rt.texture
    let threshold = cur.place.bloom
    let strength = cur.place.bloomStrength
    if (cur.next && fB) {
      cur.next.render(r, fB)
      const p = easeCut(cur.mix)
      this.cut.run(r, cur.place.rt.texture, cur.next.rt.texture, p, this.mix, {
        vel: clamp(Math.abs(this.vel) * 0.6, 0, 2.5),
        t: this.t,
        aspect: this.w / this.h,
      })
      src = this.mix.texture
      threshold = threshold + (cur.next.bloom - threshold) * p
      strength = strength + (cur.next.bloomStrength - strength) * p
    }
    const W = Math.round(this.w * this.dpr)
    const H = Math.round(this.h * this.dpr)
    const bl = this.bloom.run(r, src, W, H, threshold)
    const u = this.final.mat.uniforms
    u.tIn.value = src
    u.tBloom.value = bl
    u.uBloom.value = strength
    u.uTime.value = this.t
    quad.run(r, this.final.mat, null)
    r.autoClear = false
    r.setRenderTarget(null)
    this.ov.render(r)
    r.autoClear = true
  }

  adaptDpr(dt: number) {
    const f = this.fps
    f.acc += dt
    f.n++
    if (f.acc < f.wait) return
    const fps = f.n / f.acc
    f.acc = 0
    f.n = 0
    f.wait = 1
    if (f.changes > 5) return
    if (fps < 42 && this.dpr > 0.8) {
      this.dpr = Math.max(0.8, this.dpr * 0.85)
      f.changes++
      this.resize()
    } else if (fps > 58 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr * 1.1)
      f.changes++
      this.resize()
    }
  }

  start() {
    let last = performance.now()
    const loop = () => {
      const now = performance.now()
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      this.step(dt)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }
}

// o corte atravessa a tela com a mesma curva de tudo
function easeCut(x: number) {
  const t = clamp(x)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
