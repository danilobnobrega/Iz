import * as THREE from 'three'

// 445 peças (uma por pessoa do grupo) que se reorganizam entre composições.
// Cada transição: as peças voam da posição A para a B virando no próprio eixo;
// a frente mostra a imagem A, o verso a imagem B.

THREE.ColorManagement.enabled = false

export const N = 445

export type Tile = { x: number; y: number; w: number; h: number; u0: number; v0: number; u1: number; v1: number }
export type Rect = { x: number; y: number; w: number; h: number }

const vert = /* glsl */ `
  attribute vec4 aA;
  attribute vec4 aB;
  attribute vec4 aUA;
  attribute vec4 aUB;
  attribute float aOrder;
  attribute float aRnd;
  uniform float uT;
  uniform vec2 uRes;
  uniform vec2 uMouse;
  uniform float uTime;
  uniform float uLift;
  varying vec2 vUvA;
  varying vec2 vUvB;
  varying float vShade;
  const float PI = 3.14159265;

  float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }

  void main() {
    float span = 0.7;
    float lt = clamp(uT * (1.0 + span) - aOrder * span, 0.0, 1.0);
    lt = ease(lt);
    vec4 r = mix(aA, aB, lt);

    // repouso: respiração mínima
    float breathe = sin(uTime * 0.8 + aRnd * 6.28) * 0.6;

    float ang = lt * PI;
    vec3 p = vec3(position.x * r.z, position.y * r.w, 0.0);
    float c = cos(ang), s = sin(ang);
    p = vec3(p.x * c, p.y, -p.x * s);

    // o cursor levanta e inclina as peças por perto
    vec2 screen = vec2(r.x, r.y);
    float md = distance(screen, uMouse);
    float push = smoothstep(220.0, 0.0, md);
    vec2 dir = normalize(screen - uMouse + 0.001);
    float tx = dir.y * push * 0.55;
    float ty = -dir.x * push * 0.55;
    p = vec3(p.x, p.y * cos(tx) - p.z * sin(tx), p.y * sin(tx) + p.z * cos(tx));
    p = vec3(p.x * cos(ty) + p.z * sin(ty), p.y, -p.x * sin(ty) + p.z * cos(ty));

    float lift = sin(lt * PI) * uLift * (0.6 + aRnd * 0.8) + push * 70.0 + breathe;
    vec3 world = vec3(r.x - uRes.x * 0.5, uRes.y * 0.5 - r.y, lift) + p;

    vUvA = mix(aUA.xy, aUA.zw, uv);
    vUvB = mix(aUB.xy, aUB.zw, vec2(1.0 - uv.x, uv.y));
    vShade = 1.0 - sin(ang) * 0.45 - push * 0.08;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uDarkA;
  uniform float uDarkB;
  varying vec2 vUvA;
  varying vec2 vUvB;
  varying float vShade;
  void main() {
    vec3 col = gl_FrontFacing ? texture2D(tA, vUvA).rgb : texture2D(tB, vUvB).rgb;
    // composições tipográficas escurecem a foto pra forma ler
    float dark = gl_FrontFacing ? uDarkA : uDarkB;
    col = mix(col, col * col * 0.62, dark);
    gl_FragColor = vec4(col * vShade, 1.0);
  }
`

export class Mosaic {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(32, 1, 10, 10000)
  geo: THREE.InstancedBufferGeometry
  mat: THREE.ShaderMaterial
  w = 1
  h = 1
  private attrs: Record<string, THREE.InstancedBufferAttribute> = {}

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const base = new THREE.PlaneGeometry(1, 1)
    this.geo = new THREE.InstancedBufferGeometry()
    this.geo.index = base.index
    this.geo.setAttribute('position', base.getAttribute('position'))
    this.geo.setAttribute('uv', base.getAttribute('uv'))
    this.geo.instanceCount = N
    for (const [name, size] of [['aA', 4], ['aB', 4], ['aUA', 4], ['aUB', 4], ['aOrder', 1], ['aRnd', 1]] as const) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(N * size), size)
      a.setUsage(THREE.DynamicDrawUsage)
      this.attrs[name] = a
      this.geo.setAttribute(name, a)
    }
    const rnd = this.attrs.aRnd.array as Float32Array
    for (let i = 0; i < N; i++) rnd[i] = Math.random()
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.DoubleSide,
      uniforms: {
        tA: { value: null },
        tB: { value: null },
        uT: { value: 0 },
        uRes: { value: new THREE.Vector2() },
        uMouse: { value: new THREE.Vector2(-9999, -9999) },
        uTime: { value: 0 },
        uLift: { value: 160 },
        uDarkA: { value: 0 },
        uDarkB: { value: 0 },
      },
    })
    const mesh = new THREE.Mesh(this.geo, this.mat)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    this.resize()
  }

  resize() {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.w, this.h, false)
    const fov = (this.camera.fov * Math.PI) / 180
    this.camera.aspect = this.w / this.h
    this.camera.position.set(0, 0, this.h / 2 / Math.tan(fov / 2))
    this.camera.far = this.camera.position.z * 3
    this.camera.updateProjectionMatrix()
    this.mat.uniforms.uRes.value.set(this.w, this.h)
  }

  // define a transição A -> B
  setPair(a: Tile[], b: Tile[], texA: THREE.Texture, texB: THREE.Texture, wave: number, darkA = 0, darkB = 0) {
    this.mat.uniforms.uDarkA.value = darkA
    this.mat.uniforms.uDarkB.value = darkB
    const A = this.attrs.aA.array as Float32Array
    const B = this.attrs.aB.array as Float32Array
    const UA = this.attrs.aUA.array as Float32Array
    const UB = this.attrs.aUB.array as Float32Array
    const O = this.attrs.aOrder.array as Float32Array
    const rnd = this.attrs.aRnd.array as Float32Array
    for (let i = 0; i < N; i++) {
      const ta = a[i]
      const tb = b[i]
      A.set([ta.x, ta.y, ta.w, ta.h], i * 4)
      B.set([tb.x, tb.y, tb.w, tb.h], i * 4)
      UA.set([ta.u0, ta.v0, ta.u1, ta.v1], i * 4)
      UB.set([tb.u0, tb.v0, tb.u1, tb.v1], i * 4)
      // onda diagonal; a direção alterna a cada transição
      const nx = ta.x / this.w
      const ny = ta.y / this.h
      const o = wave > 0 ? nx * 0.75 + ny * 0.25 : 1 - nx * 0.75 - ny * 0.25
      O[i] = Math.min(1, Math.max(0, o * 0.9 + rnd[i] * 0.1))
    }
    for (const k of ['aA', 'aB', 'aUA', 'aUB', 'aOrder']) this.attrs[k].needsUpdate = true
    this.mat.uniforms.tA.value = texA
    this.mat.uniforms.tB.value = texB
  }

  render(t: number, time: number, mx: number, my: number) {
    const u = this.mat.uniforms
    u.uT.value = t
    u.uTime.value = time
    u.uMouse.value.set(mx, my)
    this.renderer.render(this.scene, this.camera)
  }
}

// ---------- composições ----------

function cover(rect: Rect, aspect: number) {
  const ra = rect.w / rect.h
  return ra > aspect ? { sx: 1, sy: aspect / ra } : { sx: ra / aspect, sy: 1 }
}

function uvFor(x: number, y: number, w: number, h: number, rect: Rect, aspect: number) {
  const { sx, sy } = cover(rect, aspect)
  const u = (px: number) => ((px - rect.x) / rect.w - 0.5) * sx + 0.5
  const v = (py: number) => 1 - (((py - rect.y) / rect.h - 0.5) * sy + 0.5)
  return { u0: u(x - w / 2), u1: u(x + w / 2), v0: v(y + h / 2), v1: v(y - h / 2) }
}

// ordena por linha e coluna relativas à caixa, pra vizinhos irem para vizinhos
function sortTiles(t: Tile[]) {
  if (!t.length) return t
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
  for (const k of t) {
    minx = Math.min(minx, k.x); maxx = Math.max(maxx, k.x)
    miny = Math.min(miny, k.y); maxy = Math.max(maxy, k.y)
  }
  const key = (k: Tile) => Math.round(((k.y - miny) / Math.max(1, maxy - miny)) * 14) * 1000 + ((k.x - minx) / Math.max(1, maxx - minx)) * 999
  return t.sort((a, b) => key(a) - key(b))
}

// completa até N com peças ocultas nascendo de peças visíveis
function pad(t: Tile[]) {
  sortTiles(t)
  const out = t.slice(0, N)
  const vis = out.length
  for (let i = vis; i < N; i++) {
    const src = out[Math.floor(((i - vis) / Math.max(1, N - vis)) * vis)] ?? { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 }
    out.push({ ...src, w: 0, h: 0 })
  }
  // espalha as ocultas entre as visíveis pra não concentrarem a onda
  return out
}

export function gridLayout(rect: Rect, aspect: number, gap = 0.045): Tile[] {
  const ra = rect.w / rect.h
  let cols = Math.max(1, Math.round(Math.sqrt(N * ra)))
  let rows = Math.max(1, Math.floor(N / cols))
  while (cols * rows > N) rows--
  const cw = rect.w / cols
  const ch = rect.h / rows
  const s = Math.min(cw, ch)
  const tw = cw - s * gap
  const th = ch - s * gap
  const out: Tile[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = rect.x + (c + 0.5) * cw
      const y = rect.y + (r + 0.5) * ch
      out.push({ x, y, w: tw, h: th, ...uvFor(x, y, tw, th, rect, aspect) })
    }
  return pad(out)
}

export function glyphLayout(text: string, rect: Rect, aspect: number, font: string, gap = 0.12): Tile[] {
  const cv = document.createElement('canvas')
  const W = Math.max(2, Math.round(rect.w))
  const H = Math.max(2, Math.round(rect.h))
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  let size = H
  ctx.font = `900 ${size}px ${font}`
  let m = ctx.measureText(text)
  const fit = Math.min((W * 0.98) / m.width, (H * 0.98) / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent))
  size *= fit
  ctx.font = `900 ${size}px ${font}`
  m = ctx.measureText(text)
  const th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  ctx.fillStyle = '#fff'
  ctx.fillText(text, (W - m.width) / 2, (H - th) / 2 + m.actualBoundingBoxAscent)
  const data = ctx.getImageData(0, 0, W, H).data
  const inside = (x: number, y: number) => {
    const xi = Math.min(W - 1, Math.max(0, Math.round(x)))
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)))
    return data[(yi * W + xi) * 4] > 127
  }
  const sample = (step: number) => {
    const pts: [number, number][] = []
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) if (inside(x, y)) pts.push([x, y])
    return pts
  }
  // procura o passo que dá o maior número de peças sem passar de N
  let lo = 2
  let hi = Math.max(W, H)
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (sample(mid).length > N) lo = mid
    else hi = mid
  }
  const step = hi
  const tw = step * (1 - gap)
  return pad(
    sample(step).map(([x, y]) => {
      const X = rect.x + x
      const Y = rect.y + y
      return { x: X, y: Y, w: tw, h: tw, ...uvFor(X, Y, tw, tw, rect, aspect) }
    }),
  )
}
