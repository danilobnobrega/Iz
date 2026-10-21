import * as THREE from 'three'
import { Section, damp, fit, toScreen, type Ctx, type Rect } from '../y/core'
import { DISPLAY, PAL, raw } from './pal'

// Um painel de plaquetas que viram, como os de estação. Cada célula tem a metade de cima fixa, a
// de baixo fixa e uma folha que cai girando na dobradiça: na frente, a metade de cima da letra
// antiga; no verso, a metade de baixo da nova. Cada troca passa por letras aleatórias antes de
// parar, com atraso por coluna. Passar o cursor numa plaqueta faz ela girar sozinha.

const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZÁÂÃÉÊÍÓÔÕÚÇ0123456789.,:-=/º!?&'
const AC = 16 // colunas do atlas
const AR = 4

const VERT = /* glsl */ `
  attribute float aPart, aA, aB, aAng, aTone;
  attribute vec2 aCell;
  uniform vec2 uTile, uGap;
  varying vec2 vUv; varying float vA; varying float vB; varying float vPart; varying float vShade; varying float vTone;
  void main(){
    vec3 p = position; // meia placa de cima: x em -0.5..0.5, y em 0..0.5
    vUv = vec2(p.x + 0.5, p.y + 0.5);
    vPart = aPart; vA = aA; vB = aB; vTone = aTone;
    vShade = 1.0;
    if (aPart == 1.0) { p.y = -p.y; vUv.y = 1.0 - vUv.y; vShade = 1.0 - sin(aAng) * 0.35; }
    if (aPart == 2.0) {
      float c = cos(aAng), s = sin(aAng);
      p = vec3(p.x, p.y * c, p.y * s + 0.002);
      vShade = 0.72 + 0.28 * abs(c);
    }
    p.xy *= uTile;
    p.y += sign(p.y) * uGap.y;
    vec3 w = vec3(aCell, 0.0) + p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
  }`

const FRAG = /* glsl */ `
  uniform sampler2D tAtlas; uniform vec3 uTileC, uInk, uAccent, uAccentInk, uCream;
  varying vec2 vUv; varying float vA; varying float vB; varying float vPart; varying float vShade; varying float vTone;
  vec2 cellUv(float ch, vec2 uv){
    float cx = mod(ch, ${AC}.0), cy = floor(ch / ${AC}.0);
    return vec2((cx + uv.x) / ${AC}.0, 1.0 - (cy + 1.0 - uv.y) / ${AR}.0);
  }
  void main(){
    vec2 uv = vUv;
    float ch = vA;
    // a folha mostra no verso a metade de baixo da letra nova (de cabeça para baixo, como na peça real)
    if (vPart == 2.0 && !gl_FrontFacing) { ch = vB; uv.y = 1.0 - uv.y; }
    float a = texture2D(tAtlas, cellUv(ch, uv)).a;
    // cantos arredondados da placa inteira (só os de fora de cada metade)
    vec2 q = vec2(abs(uv.x - 0.5) * 2.0, uv.y);
    vec2 cr = vec2(max(q.x - 0.84, 0.0) / 0.16, max(uv.y - 0.92, 0.0) / 0.08);
    float edge = length(cr) > 1.0 ? 0.0 : 1.0;
    if (vPart == 1.0) { vec2 cb = vec2(max(q.x - 0.84, 0.0) / 0.16, max(0.08 - uv.y, 0.0) / 0.08); edge = length(cb) > 1.0 ? 0.0 : 1.0; }
    if (edge < 0.5) discard;
    vec3 tile = mix(uTileC, uAccent, vTone);
    vec3 ink = mix(uCream, uAccentInk, vTone);
    vec3 col = mix(tile, ink, a);
    // brilho leve perto da dobradiça
    float hinge = smoothstep(0.08, 0.0, abs(uv.y - (vPart == 1.0 ? 1.0 : 0.0)));
    col *= vShade * (1.0 - hinge * 0.25);
    gl_FragColor = vec4(col, 1.0);
  }`

type Cell = { cur: number; queue: number[]; from: number; to: number; t: number; dur: number; delay: number; tone: number; toneTo: number }

export class FlapSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  board = new THREE.Group()
  mesh: THREE.InstancedMesh
  cols = 14
  rows = 5
  cells: Cell[] = []
  attrs: Record<string, THREE.InstancedBufferAttribute> = {}
  msgI = -1
  tilt = new THREE.Vector2()
  hover = -1

  constructor(el: HTMLElement, private messages: string[][], private accents: string[] = []) {
    super(el)
    this.scene.background = new THREE.Color(PAL.cobalt)
    // atlas das letras
    const cw = 128, ch = 192
    const cv = document.createElement('canvas')
    cv.width = cw * AC
    cv.height = ch * AR
    const x = cv.getContext('2d')!
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.font = `800 158px ${DISPLAY}`
    Array.from(CHARS).forEach((c, i) => x.fillText(c, (i % AC) * cw + cw / 2, Math.floor(i / AC) * ch + ch / 2 + 8))
    const tex = new THREE.CanvasTexture(cv)
    tex.anisotropy = 8
    const N = this.cols * this.rows * 3
    const geo = new THREE.InstancedBufferGeometry()
    const base = new THREE.PlaneGeometry(1, 0.5, 1, 1)
    base.translate(0, 0.25, 0)
    geo.index = base.index
    geo.setAttribute('position', base.attributes.position)
    const mk = (name: string, size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(N * size), size)
      a.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute(name, a)
      this.attrs[name] = a
    }
    mk('aPart', 1)
    mk('aA', 1)
    mk('aB', 1)
    mk('aAng', 1)
    mk('aTone', 1)
    mk('aCell', 2)
    geo.instanceCount = N
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        tAtlas: { value: tex },
        uTile: { value: new THREE.Vector2(0.9, 1.35) },
        uGap: { value: new THREE.Vector2(0, 0.012) },
        uTileC: { value: raw(PAL.ink) },
        uInk: { value: raw(PAL.cream) },
        uCream: { value: raw(PAL.cream) },
        uAccent: { value: raw(PAL.saffron) },
        uAccentInk: { value: raw(PAL.ink) },
      },
    })
    this.mesh = new THREE.InstancedMesh(geo as unknown as THREE.BufferGeometry, mat, N)
    this.mesh.frustumCulled = false
    this.board.add(this.mesh)
    this.scene.add(this.board)
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push({ cur: 0, queue: [], from: 0, to: 0, t: 1, dur: 0.11, delay: 0, tone: 0, toneTo: 0 })
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
    // a câmera recua até o painel caber
    const bw = this.cols * 1.0
    const bh = this.rows * 1.45
    const fov = THREE.MathUtils.degToRad(30)
    const dist = Math.max(bh / 2 / Math.tan(fov / 2), bw / 2 / Math.tan(fov / 2) / (w / h)) * 1.18
    this.cam.position.set(0, 0, dist)
  }

  setMessage(lines: string[]) {
    const C = this.cols
    const R = this.rows
    const grid: string[] = new Array(C * R).fill(' ')
    const top = Math.floor((R - lines.length) / 2)
    lines.forEach((ln, r) => {
      const s = ln.toUpperCase().slice(0, C)
      const off = Math.floor((C - s.length) / 2)
      Array.from(s).forEach((ch, k) => (grid[(top + r) * C + off + k] = ch))
    })
    this.cells.forEach((c, i) => {
      const target = Math.max(0, CHARS.indexOf(grid[i]))
      const col = i % C
      const row = Math.floor(i / C)
      const accent = this.accents.some((a) => lines[row - top]?.toUpperCase().includes(a)) && grid[i] !== ' ' ? 1 : 0
      c.toneTo = accent
      if (target === c.cur && c.queue.length === 0) return
      // passa por algumas letras antes de parar
      const steps = 2 + Math.floor(Math.random() * 5)
      c.queue = []
      for (let s = 0; s < steps; s++) c.queue.push(1 + Math.floor(Math.random() * (CHARS.length - 1)))
      c.queue.push(target)
      c.delay = col * 0.035 + row * 0.06 + Math.random() * 0.05
    })
  }

  update(p: number, c: Ctx, rect: Rect) {
    const n = this.messages.length
    const k = Math.min(n - 1, Math.floor(fit(p, 0.0, 0.92) * n))
    if (k !== this.msgI) {
      this.msgI = k
      this.setMessage(this.messages[k])
    }
    const m = this.local(c, rect)
    // plaqueta sob o cursor gira uma vez
    if (m.inside) {
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(m.x, m.y), this.cam)
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3())
      if (hit) {
        const col = Math.floor(hit.x + this.cols / 2)
        const row = Math.floor(this.rows / 2 - hit.y / 1.45)
        const i = row * this.cols + col
        if (col >= 0 && col < this.cols && row >= 0 && row < this.rows && i !== this.hover) {
          this.hover = i
          const cell = this.cells[i]
          if (cell.queue.length === 0 && cell.t >= 1) {
            cell.queue = [1 + Math.floor(Math.random() * (CHARS.length - 1)), 1 + Math.floor(Math.random() * (CHARS.length - 1)), cell.cur]
            cell.delay = 0
          }
        }
      }
    }
    this.tilt.x += ((m.inside ? m.x : 0) - this.tilt.x) * damp(0.05, c.dt)
    this.tilt.y += ((m.inside ? m.y : 0) - this.tilt.y) * damp(0.05, c.dt)
    this.board.rotation.set(-this.tilt.y * 0.12 - 0.04, this.tilt.x * 0.18, 0)

    const A = this.attrs
    const C = this.cols
    this.cells.forEach((cell, i) => {
      if (cell.delay > 0) cell.delay -= c.dt
      else if (cell.t >= 1 && cell.queue.length) {
        cell.from = cell.cur
        cell.to = cell.queue.shift()!
        cell.t = 0
        cell.dur = cell.queue.length ? 0.075 : 0.16
      }
      if (cell.t < 1) {
        cell.t = Math.min(1, cell.t + c.dt / cell.dur)
        if (cell.t >= 1) cell.cur = cell.to
      }
      cell.tone += (cell.toneTo - cell.tone) * damp(0.15, c.dt)
      const flipping = cell.t < 1
      // a folha cai acelerando, como gravidade, e quica de leve no fim
      const e = cell.t * cell.t
      const ang = flipping ? e * Math.PI : 0
      const x = (i % C) - C / 2 + 0.5
      const y = this.rows / 2 - Math.floor(i / C) - 0.5
      const y2 = y * 1.45
      const set = (j: number, part: number, a: number, b: number, an: number) => {
        A.aPart.setX(j, part)
        A.aA.setX(j, a)
        A.aB.setX(j, b)
        A.aAng.setX(j, an)
        A.aTone.setX(j, cell.tone)
        A.aCell.setXY(j, x, y2)
      }
      const from = flipping ? cell.from : cell.cur
      const to = flipping ? cell.to : cell.cur
      set(i * 3, 0, to, to, 0) // de cima: já é a letra nova
      set(i * 3 + 1, 1, ang > Math.PI / 2 ? to : from, 0, flipping ? ang : 0) // de baixo: troca quando a folha passa
      set(i * 3 + 2, 2, from, to, flipping ? ang : 0) // folha
    })
    for (const k of Object.keys(A)) A[k].needsUpdate = true
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
