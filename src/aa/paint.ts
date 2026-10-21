import * as THREE from 'three'
import opentype from 'opentype.js'
import fontUrl from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff?url'
import { Section, Quad, FS_VERT, damp, fit, type Ctx, type Rect } from '../y/core'

// Abertura: pintura de luz em longa exposição. Uma faísca percorre o contorno do Íz, deixando o
// rastro gravado na "chapa"; o cursor também pinta. Cada traço é uma cápsula aditiva de luz quente
// com núcleo quase branco; faíscas soltas voam e caem. A chapa esmaece devagar (exposição longa)
// e, ao rolar, mais rápido.

const STROKE_VERT = /* glsl */ `
  attribute vec2 aA; attribute vec2 aB; attribute float aW; attribute float aI; attribute vec3 aC;
  uniform vec2 uRes;
  varying vec2 vP; varying vec2 vA; varying vec2 vB; varying float vW; varying float vI; varying vec3 vC;
  void main(){
    // quad que cobre o segmento com folga do raio
    vec2 d = normalize(aB - aA + 1e-5);
    vec2 n = vec2(-d.y, d.x);
    float r = aW * 3.0;
    vec2 p = mix(aA - d * r, aB + d * r, position.x * 0.5 + 0.5) + n * position.y * r;
    vP = p; vA = aA; vB = aB; vW = aW; vI = aI; vC = aC;
    gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
  }`
const STROKE_FRAG = /* glsl */ `
  varying vec2 vP; varying vec2 vA; varying vec2 vB; varying float vW; varying float vI; varying vec3 vC;
  void main(){
    vec2 pa = vP - vA, ba = vB - vA;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float d = length(pa - ba * h);
    float core = exp(-d * d / (vW * vW * 0.18));
    float glow = exp(-d * d / (vW * vW * 2.5)) * 0.35;
    vec3 c = vC * (core * 1.4 + glow) + vec3(1.0) * core * core * 0.6;
    gl_FragColor = vec4(c * vI, 1.0);
  }`

const SHOW = /* glsl */ `
  uniform sampler2D tAcc, tBlur; uniform float uTime, uExp;
  varying vec2 vUv;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  void main(){
    vec3 c = texture2D(tAcc, vUv).rgb + texture2D(tBlur, vUv).rgb * 0.9;
    c *= uExp;
    vec3 bg = vec3(0.022, 0.018, 0.016);
    vec3 col = bg + aces(c);
    col = pow(col, vec3(1.0 / 1.1));
    col += (h2(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }`

const FADE = /* glsl */ `uniform sampler2D t; uniform float uK; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb * uK, 1.0); }`
const BLUR = /* glsl */ `uniform sampler2D t; uniform vec2 uDir; varying vec2 vUv;
  void main(){ vec3 s = vec3(0.0); float w = 0.0;
    for (int i = -6; i <= 6; i++){ float k = exp(-float(i*i) / 18.0); s += texture2D(t, vUv + uDir * float(i)).rgb * k; w += k; }
    gl_FragColor = vec4(s / w, 1.0); }`

type Spark = { x: number; y: number; vx: number; vy: number; life: number; px: number; py: number }

export class PaintSec extends Section {
  acc = [0, 1].map(() => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false }))
  blurA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false })
  blurB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false })
  ai = 0
  quad = new Quad()
  fade = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: FADE, depthTest: false, uniforms: { t: { value: null }, uK: { value: 0.99 } } })
  blur = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: BLUR, depthTest: false, uniforms: { t: { value: null }, uDir: { value: new THREE.Vector2() } } })
  show = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: SHOW, depthTest: false, uniforms: { tAcc: { value: null }, tBlur: { value: null }, uTime: { value: 0 }, uExp: { value: 1 } } })
  strokes = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  geo = new THREE.InstancedBufferGeometry()
  max = 4000
  n = 0
  A: THREE.InstancedBufferAttribute
  B: THREE.InstancedBufferAttribute
  Wd: THREE.InstancedBufferAttribute
  I: THREE.InstancedBufferAttribute
  C: THREE.InstancedBufferAttribute
  mat: THREE.ShaderMaterial
  path: [number, number][][] = [] // contornos do Íz em 0..1
  total = 0
  drawn = 0
  sparks: Spark[] = []
  last = { x: -1, y: -1 }
  t0 = -1

  constructor(el: HTMLElement) {
    super(el)
    const base = new THREE.PlaneGeometry(2, 2)
    this.geo.index = base.index
    this.geo.setAttribute('position', base.attributes.position)
    const mk = (s: number) => new THREE.InstancedBufferAttribute(new Float32Array(this.max * s), s).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute
    this.A = mk(2)
    this.B = mk(2)
    this.Wd = mk(1)
    this.I = mk(1)
    this.C = mk(3)
    this.geo.setAttribute('aA', this.A)
    this.geo.setAttribute('aB', this.B)
    this.geo.setAttribute('aW', this.Wd)
    this.geo.setAttribute('aI', this.I)
    this.geo.setAttribute('aC', this.C)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STROKE_VERT,
      fragmentShader: STROKE_FRAG,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true,
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) } },
    })
    const mesh = new THREE.Mesh(this.geo as unknown as THREE.BufferGeometry, this.mat)
    mesh.frustumCulled = false
    this.strokes.add(mesh)
  }

  async init() {
    const font = opentype.parse(await (await fetch(fontUrl)).arrayBuffer())
    const p = font.getPath('Íz', 0, 0, 1)
    const bb = p.getBoundingBox()
    const s = 1 / Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1)
    const out: [number, number][][] = []
    let cur: [number, number][] = []
    let cx = 0, cy = 0
    const push = (x: number, y: number) => cur.push([(x - bb.x1) * s, (bb.y2 - y) * s])
    for (const c of p.commands as any[]) {
      if (c.type === 'M') {
        if (cur.length > 1) out.push(cur)
        cur = []
        cx = c.x; cy = c.y
        push(cx, cy)
      } else if (c.type === 'L') { cx = c.x; cy = c.y; push(cx, cy) }
      else if (c.type === 'Q') {
        for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; push(u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y) }
        cx = c.x; cy = c.y
      } else if (c.type === 'C') {
        for (let i = 1; i <= 14; i++) { const t = i / 14, u = 1 - t; push(u*u*u*cx + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x, u*u*u*cy + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y) }
        cx = c.x; cy = c.y
      } else if (c.type === 'Z') {
        if (cur.length) cur.push(cur[0])
        if (cur.length > 1) out.push(cur)
        cur = []
      }
    }
    this.path = out
    this.total = out.reduce((a, r) => a + r.length - 1, 0)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const W = Math.round(w * dpr), H = Math.round(h * dpr)
    this.acc.forEach((a) => a.setSize(W, H))
    this.blurA.setSize(Math.round(W / 4), Math.round(H / 4))
    this.blurB.setSize(Math.round(W / 4), Math.round(H / 4))
    this.mat.uniforms.uRes.value.set(W, H)
  }

  seg(ax: number, ay: number, bx: number, by: number, w: number, i: number, c: [number, number, number]) {
    if (this.n >= this.max) return
    const k = this.n++
    this.A.setXY(k, ax, ay)
    this.B.setXY(k, bx, by)
    this.Wd.setX(k, w)
    this.I.setX(k, i)
    this.C.setXYZ(k, c[0], c[1], c[2])
  }

  update(p: number, c: Ctx, rect: Rect) {
    if (this.t0 < 0) this.t0 = c.t
    const d = c.dpr
    const W = rect.w * d, H = rect.h * d
    this.n = 0
    const warm: [number, number, number] = [1.0, 0.62, 0.28]
    // a faísca escreve o contorno do Íz em ~3,5 s
    const size = Math.min(W * 0.55, H * 0.72)
    const ox = (W - size * 0.9) / 2
    const oy = (H - size * 0.8) / 2
    const target = Math.min(this.total, ((c.t - this.t0 - 0.6) / 3.5) * this.total)
    let head: [number, number] | null = null
    if (target > this.drawn) {
      let k = 0
      for (const ring of this.path) {
        for (let i = 0; i < ring.length - 1; i++, k++) {
          if (k < this.drawn || k >= target) continue
          const [x0, y0] = ring[i], [x1, y1] = ring[i + 1]
          const A = [ox + x0 * size, oy + y0 * size], B = [ox + x1 * size, oy + y1 * size]
          this.seg(A[0], A[1], B[0], B[1], 3.2 * d, 0.6, warm)
          head = [B[0], B[1]]
        }
      }
      this.drawn = target
    }
    // faíscas que saltam da ponta
    if (head) for (let s = 0; s < 2; s++) this.sparks.push({ x: head[0], y: head[1], px: head[0], py: head[1], vx: (Math.random() - 0.5) * 700 * d, vy: (Math.random() - 0.3) * 600 * d, life: 0.12 + Math.random() * 0.25 })
    // o cursor também pinta
    const m = this.local(c, rect)
    const mx = ((m.x + 1) / 2) * W, my = ((m.y + 1) / 2) * H
    if (m.inside && this.last.x >= 0) {
      const sp = Math.hypot(mx - this.last.x, my - this.last.y)
      if (sp > 0.5) {
        this.seg(this.last.x, this.last.y, mx, my, (2.4 + Math.min(4, sp * 0.03)) * d, 0.55, [1.0, 0.55 + Math.sin(c.t * 0.7) * 0.15, 0.25 + Math.cos(c.t * 0.5) * 0.15])
        if (Math.random() < 0.5) this.sparks.push({ x: mx, y: my, px: mx, py: my, vx: (Math.random() - 0.5) * 300 * d, vy: Math.random() * 300 * d, life: 0.2 + Math.random() * 0.3 })
      }
    }
    this.last = m.inside ? { x: mx, y: my } : { x: -1, y: -1 }
    const dt = c.dt
    this.sparks = this.sparks.filter((s) => {
      s.px = s.x; s.py = s.y
      s.vy -= 900 * d * dt
      s.vx *= 0.98; s.vy *= 0.98
      s.x += s.vx * dt; s.y += s.vy * dt
      s.life -= dt
      this.seg(s.px, s.py, s.x, s.y, 0.9 * d, Math.max(0, s.life) * 1.2, [1.0, 0.75, 0.45])
      return s.life > 0
    })
    for (const a of [this.A, this.B, this.Wd, this.I, this.C]) a.needsUpdate = true
    this.geo.instanceCount = this.n
    // exposição: longa no começo, curta ao rolar
    this.fade.uniforms.uK.value = Math.pow(0.996 - fit(p, 0.3, 0.9) * 0.05, c.dt * 60)
    this.show.uniforms.uTime.value = c.t
    this.show.uniforms.uExp.value = 1 - fit(p, 0.85, 1) * 0.8
    void damp
  }

  render(c: Ctx, rect: Rect) {
    const r = c.r
    const src = this.acc[this.ai]
    const dst = this.acc[1 - this.ai]
    this.fade.uniforms.t.value = src.texture
    this.quad.draw(r, this.fade, dst)
    r.setRenderTarget(dst)
    r.render(this.strokes, this.cam)
    this.ai = 1 - this.ai
    this.blur.uniforms.t.value = dst.texture
    this.blur.uniforms.uDir.value.set(1 / this.blurA.width, 0)
    this.quad.draw(r, this.blur, this.blurA)
    this.blur.uniforms.t.value = this.blurA.texture
    this.blur.uniforms.uDir.value.set(0, 1 / this.blurA.height)
    this.quad.draw(r, this.blur, this.blurB)
    this.show.uniforms.tAcc.value = dst.texture
    this.show.uniforms.tBlur.value = this.blurB.texture
    this.quad.screen(c, rect, this.show)
  }
}
