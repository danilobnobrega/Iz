import * as THREE from 'three'
import { clamp } from './util'

// Todo texto da V é desenhado dentro do WebGL: cada rótulo é uma textura gerada no pixel exato
// da tela (com o dpr), presa numa câmera ortográfica por cima das cenas. Assim ele pode se
// embaralhar e se decodificar letra a letra, e continua nítido como texto de verdade.

export const FONTS = {
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
  serif: '"Instrument Serif", Georgia, serif',
}

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>[]=+-_#'

export class Overlay {
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10)
  w = 1
  h = 1
  dpr = 1
  labels = new Set<Label>()
  lines: Lines
  dots: Dots

  constructor() {
    this.lines = new Lines(this)
    this.dots = new Dots(this)
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.camera.right = w
    this.camera.bottom = -h
    this.camera.updateProjectionMatrix()
    const changed = dpr !== this.dpr
    this.dpr = dpr
    if (changed) this.labels.forEach((l) => l.layout())
    this.dots.material.uniforms.uDpr.value = dpr
  }

  update(dt: number) {
    this.labels.forEach((l) => l.tick(dt))
  }

  render(r: THREE.WebGLRenderer) {
    this.lines.flush()
    this.dots.flush()
    r.render(this.scene, this.camera)
    this.lines.reset()
    this.dots.reset()
  }
}

export type LabelOpts = {
  font?: keyof typeof FONTS
  size?: number
  weight?: number
  color?: string
  spacing?: number // em px
  lineHeight?: number // múltiplo do tamanho
  maxWidth?: number
  align?: 'left' | 'right' | 'center'
  dur?: number // segundos para decodificar
  spread?: number
  upper?: boolean
}

export class Label {
  o: Required<LabelOpts>
  canvas = document.createElement('canvas')
  ctx = this.canvas.getContext('2d')!
  tex = new THREE.CanvasTexture(this.canvas)
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  text = ''
  lines: { chars: string[]; xs: number[]; y: number }[] = []
  count = 0
  width = 0 // px css
  height = 0
  x = 0
  y = 0
  alpha = 1
  p = 0 // progresso da decodificação
  target = 0
  speed = 1
  seed = Math.random() * 1000
  dirty = true
  lastScramble = 0
  bold = new Set<number>() // índices de caracteres em destaque (peso maior)

  constructor(private ov: Overlay, text: string, opts: LabelOpts = {}) {
    this.o = {
      font: 'mono',
      size: 11,
      weight: 400,
      color: '#ece6dc',
      spacing: 0.4,
      lineHeight: 1.5,
      maxWidth: 0,
      align: 'left',
      dur: 0.7,
      spread: 1.6,
      upper: false,
      ...opts,
    }
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.tex.minFilter = THREE.LinearFilter
    this.tex.magFilter = THREE.LinearFilter
    this.tex.generateMipmaps = false
    const g = new THREE.PlaneGeometry(1, 1)
    g.translate(0.5, -0.5, 0)
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }),
    )
    this.mesh.renderOrder = 10
    this.mesh.frustumCulled = false
    ov.scene.add(this.mesh)
    ov.labels.add(this)
    this.set(text)
  }

  font() {
    return `${this.o.weight} ${this.o.size * this.ov.dpr}px ${FONTS[this.o.font]}`
  }

  set(text: string) {
    if (this.o.upper) text = text.toUpperCase()
    if (text === this.text && this.lines.length) return
    this.text = text
    this.layout()
  }

  layout() {
    const d = this.ov.dpr
    const c = this.ctx
    c.font = this.font()
    c.letterSpacing = `${this.o.spacing * d}px`
    const maxW = this.o.maxWidth * d
    const raw: string[] = []
    for (const para of this.text.split('\n')) {
      if (!maxW) {
        raw.push(para)
        continue
      }
      let line = ''
      for (const w of para.split(' ')) {
        const tryLine = line ? line + ' ' + w : w
        if (c.measureText(tryLine).width > maxW && line) {
          raw.push(line)
          line = w
        } else line = tryLine
      }
      raw.push(line)
    }
    const lh = this.o.size * this.o.lineHeight * d
    let wMax = 0
    this.lines = raw.map((l, li) => {
      const chars = Array.from(l)
      const xs: number[] = []
      let acc = ''
      for (const ch of chars) {
        xs.push(c.measureText(acc).width)
        acc += ch
      }
      wMax = Math.max(wMax, c.measureText(l).width)
      return { chars, xs, y: li * lh }
    })
    this.count = this.lines.reduce((s, l) => s + l.chars.length, 0)
    const pad = Math.ceil(4 * d)
    this.canvas.width = Math.ceil(wMax + pad * 2)
    this.canvas.height = Math.ceil(raw.length * lh + pad * 2)
    this.width = this.canvas.width / d
    this.height = this.canvas.height / d
    this.tex.dispose()
    this.tex.image = this.canvas
    this.mesh.scale.set(this.width, this.height, 1)
    this.dirty = true
  }

  show(on = true, delay = 0) {
    if (delay > 0) {
      setTimeout(() => this.show(on), delay * 1000)
      return this
    }
    this.target = on ? 1 : 0
    this.speed = 1 / this.o.dur
    return this
  }

  // reembaralha e decodifica de novo (para troca de texto)
  replay(text?: string) {
    if (text !== undefined) this.set(text)
    this.p = 0
    this.target = 1
    this.dirty = true
  }

  place(x: number, y: number) {
    const d = this.ov.dpr
    const pad = 4
    let px = x - pad
    if (this.o.align === 'right') px = x - this.width + pad
    else if (this.o.align === 'center') px = x - this.width / 2
    this.x = px
    this.y = y - pad
    this.mesh.position.set(Math.round(px * d) / d, -Math.round((y - pad) * d) / d, 0)
  }

  tick(dt: number) {
    const before = this.p
    if (this.p !== this.target) {
      const s = this.speed * dt
      this.p = this.p < this.target ? Math.min(this.target, this.p + s) : Math.max(this.target, this.p - s * 1.4)
    }
    const moving = this.p > 0 && this.p < 1
    const now = performance.now()
    if (moving && now - this.lastScramble > 55) {
      this.lastScramble = now
      this.dirty = true
    }
    if (before !== this.p) this.dirty = true
    if (this.dirty) this.draw()
    this.mesh.material.opacity = this.alpha
    this.mesh.visible = this.alpha > 0.001 && this.p > 0
  }

  draw() {
    this.dirty = false
    const c = this.ctx
    const d = this.ov.dpr
    const pad = Math.ceil(4 * d)
    c.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (this.p <= 0) {
      this.tex.needsUpdate = true
      return
    }
    c.font = this.font()
    c.letterSpacing = `${this.o.spacing * d}px`
    c.textBaseline = 'top'
    const S = this.o.spread
    const n = Math.max(1, this.count - 1)
    let i = 0
    const lhOff = (this.o.size * (this.o.lineHeight - 1) * d) / 2
    for (const line of this.lines) {
      for (let k = 0; k < line.chars.length; k++, i++) {
        const ch = line.chars[k]
        if (ch === ' ') continue
        const ord = i / n
        const local = clamp(this.p * (1 + S) - ord * S)
        if (local <= 0) continue
        let g = ch
        let a = 1
        if (local < 0.62) {
          const r = Math.floor((Math.sin((i + 1) * 91.7 + this.seed + performance.now() * 0.013) * 0.5 + 0.5) * SCRAMBLE.length)
          g = SCRAMBLE[r % SCRAMBLE.length]
          a = 0.35 + local * 0.6
        }
        c.globalAlpha = a
        if (this.bold.has(i)) {
          c.font = `${Math.min(800, this.o.weight + 300)} ${this.o.size * d}px ${FONTS[this.o.font]}`
          c.fillStyle = this.o.color
          c.fillText(g, pad + line.xs[k], pad + line.y + lhOff)
          c.font = this.font()
        } else {
          c.fillStyle = this.o.color
          c.fillText(g, pad + line.xs[k], pad + line.y + lhOff)
        }
      }
    }
    c.globalAlpha = 1
    this.tex.needsUpdate = true
  }

  dispose() {
    this.ov.scene.remove(this.mesh)
    this.ov.labels.delete(this)
    this.tex.dispose()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

// linhas finas de 1px (constelações, cotovelos das fichas)
export class Lines {
  max = 4000
  pos = new Float32Array(this.max * 2 * 3)
  col = new Float32Array(this.max * 2 * 4)
  n = 0
  geo = new THREE.BufferGeometry()
  obj: THREE.LineSegments

  constructor(ov: Overlay) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage))
    this.obj = new THREE.LineSegments(
      this.geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false }),
    )
    this.obj.frustumCulled = false
    this.obj.renderOrder = 9
    ov.scene.add(this.obj)
  }

  seg(x0: number, y0: number, x1: number, y1: number, a: number, a1 = a, c = [0.93, 0.9, 0.86]) {
    if (this.n >= this.max || (a <= 0.002 && a1 <= 0.002)) return
    const i = this.n++
    this.pos.set([x0 + 0.5, -y0 - 0.5, 0, x1 + 0.5, -y1 - 0.5, 0], i * 6)
    this.col.set([c[0], c[1], c[2], a, c[0], c[1], c[2], a1], i * 8)
  }

  flush() {
    this.geo.setDrawRange(0, this.n * 2)
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  reset() {
    this.n = 0
  }
}

// pontos quadrados nítidos (vértices das constelações)
export class Dots {
  max = 2000
  pos = new Float32Array(this.max * 3)
  data = new Float32Array(this.max * 2) // tamanho, alfa
  n = 0
  geo = new THREE.BufferGeometry()
  material: THREE.ShaderMaterial

  constructor(ov: Overlay) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 2).setUsage(THREE.DynamicDrawUsage))
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uDpr: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec2 aData; uniform float uDpr; varying float vA;
        void main(){ vA = aData.y; gl_PointSize = aData.x * uDpr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        varying float vA; void main(){ gl_FragColor = vec4(vec3(0.95,0.92,0.88), vA); }`,
    })
    const pts = new THREE.Points(this.geo, this.material)
    pts.frustumCulled = false
    pts.renderOrder = 9
    ov.scene.add(pts)
  }

  dot(x: number, y: number, size: number, a: number) {
    if (this.n >= this.max || a <= 0.002) return
    const i = this.n++
    this.pos.set([Math.round(x) + 0.5, -Math.round(y) - 0.5, 0], i * 3)
    this.data.set([size, a], i * 2)
  }

  flush() {
    this.geo.setDrawRange(0, this.n)
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aData as THREE.BufferAttribute).needsUpdate = true
  }

  reset() {
    this.n = 0
  }
}

// projeta um ponto 3D para pixels css
const _v = new THREE.Vector3()
export function toScreen(p: THREE.Vector3, cam: THREE.Camera, w: number, h: number, out = { x: 0, y: 0, z: 0 }) {
  _v.copy(p).project(cam)
  out.x = (_v.x * 0.5 + 0.5) * w
  out.y = (-_v.y * 0.5 + 0.5) * h
  out.z = _v.z
  return out
}
