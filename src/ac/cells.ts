import * as THREE from 'three'
import { Section, ease, fit, toScreen, type Ctx, type Rect } from '../y/core'

// "445 → 520": um tecido de 445 células coradas (núcleo roxo, citoplasma rosa, como numa lâmina
// de histologia). Rolando, 75 delas se dividem: o núcleo se duplica, a célula alonga, estrangula
// no meio e vira duas; as vizinhas se acomodam. O contador acompanha. O cursor empurra as células.

const START = 445
const END = 520

const VERT = /* glsl */ `
  attribute vec4 aCell; // x, y, raio, divisão (0..1)
  attribute vec2 aAxis; // ângulo, semente
  varying vec2 vP; varying float vK; varying float vSeed; varying float vR;
  void main(){
    float r = aCell.z;
    float ext = r * (1.0 + aCell.w * 1.2) * 1.25;
    vec2 p = position.xy * ext;
    float c = cos(aAxis.x), s = sin(aAxis.x);
    vP = mat2(c, s, -s, c) * p / r; // em unidades de raio, eixo da divisão em x
    vK = aCell.w; vSeed = aAxis.y; vR = r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aCell.xy + p, 0.0, 1.0);
  }`
const FRAG = /* glsl */ `
  varying vec2 vP; varying float vK; varying float vSeed; varying float vR;
  float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
  float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  void main(){
    float k = vK;
    float sep = k * 0.95;
    float rr = mix(1.0, 0.78, k);
    float k2 = mix(0.6, 0.02, smoothstep(0.55, 1.0, k));
    // forma: uma célula, ou duas que se separam (união suave que vai afinando)
    float wob = (n2(vP * 2.0 + vSeed * 10.0) - 0.5) * 0.12;
    float d = smin(length(vP - vec2(sep, 0.0)) - rr, length(vP + vec2(sep, 0.0)) - rr, k2) + wob;
    if (d > 0.04) discard;
    // núcleo(s): um que alonga e se divide
    float ns = smoothstep(0.2, 0.55, k) * sep;
    float dn = smin(length((vP - vec2(ns, 0.0)) * vec2(1.0 - k * 0.3, 1.0)) - 0.42, length((vP + vec2(ns, 0.0)) * vec2(1.0 - k * 0.3, 1.0)) - 0.42, 0.15);
    vec3 cyto = vec3(0.93, 0.62, 0.72) * (0.86 + 0.25 * n2(vP * 9.0 + vSeed * 30.0));
    vec3 nuc = vec3(0.36, 0.2, 0.5) * (0.75 + 0.4 * n2(vP * 14.0 + vSeed));
    vec3 col = mix(cyto, nuc, smoothstep(0.03, -0.03, dn));
    // cromatina em grãos no núcleo
    col *= 1.0 - smoothstep(0.65, 0.9, n2(vP * 22.0 + vSeed * 5.0)) * smoothstep(0.0, -0.05, dn) * 0.4;
    // membrana mais escura e borda suave
    col *= 1.0 - smoothstep(-0.12, 0.0, d) * 0.35;
    float a = smoothstep(0.04, -0.01, d);
    gl_FragColor = vec4(col, a);
  }`

type Cell = { x: number; y: number; r: number; vx: number; vy: number; k: number; ang: number; seed: number; div: number; child: number }

export class CellsSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
  geo = new THREE.InstancedBufferGeometry()
  aCell: THREE.InstancedBufferAttribute
  aAxis: THREE.InstancedBufferAttribute
  cells: Cell[] = []
  count: HTMLElement | null

  constructor(el: HTMLElement) {
    super(el)
    this.count = el.querySelector('.ac-count')
    this.scene.background = new THREE.Color('#f4ece9')
    const base = new THREE.PlaneGeometry(2, 2)
    this.geo.index = base.index
    this.geo.setAttribute('position', base.attributes.position)
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(END * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute
    this.aAxis = new THREE.InstancedBufferAttribute(new Float32Array(END * 2), 2).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute
    this.geo.setAttribute('aCell', this.aCell)
    this.geo.setAttribute('aAxis', this.aAxis)
    const mesh = new THREE.Mesh(this.geo as unknown as THREE.BufferGeometry, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false }))
    mesh.frustumCulled = false
    this.scene.add(mesh)
    // tecido inicial: espiral de girassol num disco
    const R0 = 0.034
    for (let i = 0; i < START; i++) {
      const a = i * 2.39996
      const rad = Math.sqrt(i + 0.5) * R0 * 1.75
      this.cells.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, r: R0 * (0.85 + Math.random() * 0.3), vx: 0, vy: 0, k: 0, ang: Math.random() * Math.PI, seed: Math.random(), div: -1, child: -1 })
    }
    // 75 escolhidas para dividir, numa ordem espalhada
    const idx = [...this.cells.keys()].sort(() => Math.random() - 0.5).slice(0, END - START)
    idx.forEach((ci, n) => (this.cells[ci].div = n))
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const a = w / h
    const k = a < 1 ? 0.95 / a : 0.95
    this.cam.left = -a * k
    this.cam.right = a * k
    this.cam.top = k
    this.cam.bottom = -k
    this.cam.updateProjectionMatrix()
  }

  update(p: number, c: Ctx, rect: Rect) {
    const prog = fit(p, 0.12, 0.85)
    const total = END - START
    let born = 0
    for (let i = 0; i < START; i++) {
      const cl = this.cells[i]
      if (cl.div < 0) continue
      const t0 = cl.div / total
      cl.k = ease(fit(prog, t0 * 0.8, t0 * 0.8 + 0.2))
      if (cl.k >= 1) born++
    }
    if (this.count) this.count.textContent = String(START + born)
    // a física das células: cada uma empurra as que encostam; o cursor empurra também
    const m = this.local(c, rect)
    const mx = m.x * this.cam.right, my = m.y * this.cam.top
    const all = this.cells
    for (let i = 0; i < all.length; i++) {
      const a = all[i]
      const ra = a.r * (1 + a.k * 0.9)
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j]
        const dx = b.x - a.x, dy = b.y - a.y
        const min = ra + b.r * (1 + b.k * 0.9)
        const d2 = dx * dx + dy * dy
        if (d2 < min * min && d2 > 1e-9) {
          const d = Math.sqrt(d2)
          const push = (min - d) * 0.25 / d
          a.vx -= dx * push; a.vy -= dy * push
          b.vx += dx * push; b.vy += dy * push
        }
      }
      // leve atração ao centro para o tecido não se espalhar
      a.vx -= a.x * 0.002
      a.vy -= a.y * 0.002
      if (m.inside) {
        const dx = a.x - mx, dy = a.y - my
        const d = Math.hypot(dx, dy) + 1e-4
        if (d < 0.18) { a.vx += (dx / d) * (0.18 - d) * 0.15; a.vy += (dy / d) * (0.18 - d) * 0.15 }
      }
    }
    for (const a of all) {
      a.vx *= 0.6
      a.vy *= 0.6
      a.x += a.vx
      a.y += a.vy
    }
    // divisão concluída: a célula vira duas
    for (let i = 0; i < START; i++) {
      const a = all[i]
      if (a.k >= 1 && a.child < 0) {
        const nr = a.r * 0.92
        const ox = Math.cos(a.ang) * a.r * 0.95, oy = Math.sin(a.ang) * a.r * 0.95
        a.child = all.length
        all.push({ x: a.x - ox, y: a.y - oy, r: nr, vx: 0, vy: 0, k: 0, ang: Math.random() * Math.PI, seed: Math.random(), div: -1, child: -1 })
        a.x += ox
        a.y += oy
        a.r = nr
        a.k = 0
        a.div = -1
      }
    }
    all.forEach((cl, i) => {
      this.aCell.setXYZW(i, cl.x, cl.y, cl.r, cl.k)
      this.aAxis.setXY(i, cl.ang, cl.seed)
    })
    this.aCell.needsUpdate = true
    this.aAxis.needsUpdate = true
    this.geo.instanceCount = all.length
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
