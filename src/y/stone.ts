import * as THREE from 'three'
import opentype from 'opentype.js'
import polygonClipping, { type MultiPolygon, type Ring } from 'polygon-clipping'
import { fractureIz, type Piece } from '../v/fracture'
import fontUrl from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff?url'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from './core'

// "Reconhecimento": "12º" em mármore claro, partido em peças. As peças chegam de longe, girando,
// e se encaixam de baixo para cima conforme se rola; depois de montadas, o cursor levanta as
// peças perto dele (cada uma pelo próprio eixo, com mola) e mostra as faces de quebra.

async function textPolygons(text: string, width: number) {
  const font = opentype.parse(await (await fetch(fontUrl)).arrayBuffer())
  const path = font.getPath(text, 0, 0, 100)
  const rings: Ring[] = []
  let ring: [number, number][] = []
  let cx = 0, cy = 0
  const push = (x: number, y: number) => ring.push([x, -y])
  for (const c of path.commands as any[]) {
    if (c.type === 'M') {
      if (ring.length > 2) rings.push(ring)
      ring = []
      cx = c.x
      cy = c.y
      push(cx, cy)
    } else if (c.type === 'L') {
      cx = c.x
      cy = c.y
      push(cx, cy)
    } else if (c.type === 'Q') {
      for (let i = 1; i <= 10; i++) {
        const t = i / 10, u = 1 - t
        push(u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y)
      }
      cx = c.x
      cy = c.y
    } else if (c.type === 'C') {
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, u = 1 - t
        push(u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y)
      }
      cx = c.x
      cy = c.y
    } else if (c.type === 'Z') {
      if (ring.length > 2) rings.push(ring)
      ring = []
    }
  }
  if (ring.length > 2) rings.push(ring)
  // par-ímpar: o xor de todos os contornos dá as letras com os furos certos
  let mp: MultiPolygon = [[rings[0]]]
  for (const r of rings.slice(1)) mp = polygonClipping.xor(mp, [[r]])
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const poly of mp) for (const rr of poly) for (const [x, y] of rr) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  const s = width / (x1 - x0)
  const out = mp.map((poly) => poly.map((rr) => rr.map(([x, y]) => [(x - (x0 + x1) / 2) * s, (y - (y0 + y1) / 2) * s] as [number, number]))) as MultiPolygon
  return { mp: out, height: (y1 - y0) * s }
}

const HEAD = /* glsl */ `
  attribute float aPiece; attribute vec3 aCenter; uniform sampler2D uState;
  varying vec3 vLocal; varying vec3 vLN; varying float vGlow;
  vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`
const BEGIN = /* glsl */ `
  vec4 st0 = texelFetch(uState, ivec2(int(aPiece), 0), 0);
  vec4 qq = texelFetch(uState, ivec2(int(aPiece), 1), 0);
  vec3 transformed = aCenter + st0.xyz + qrot(qq, position - aCenter);
  vLocal = position; vLN = normal; vGlow = st0.w;
`

export class StoneSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  group = new THREE.Group()
  pieces: Piece[] = []
  n = 0
  data!: Float32Array
  state!: THREE.DataTexture
  disp!: Float32Array
  t2!: Float32Array
  scatter: THREE.Vector3[] = []
  phase: number[] = []
  mouse = new THREE.Vector3(0, -99, 0)
  ray = new THREE.Raycaster()
  plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.2)
  ready = false

  constructor(el: HTMLElement, private text: string) {
    super(el)
    this.scene.background = new THREE.Color('#e3e0db')
    const hemi = new THREE.HemisphereLight('#ffffff', '#bcb5aa', 1.5)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight('#fff4e6', 2.4)
    key.position.set(-3, 4, 6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const sc = key.shadow.camera as THREE.OrthographicCamera
    sc.left = -4
    sc.right = 4
    sc.top = 3
    sc.bottom = -3
    key.shadow.radius = 5
    key.shadow.bias = -0.0005
    this.scene.add(key)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.ShadowMaterial({ opacity: 0.12 }))
    wall.position.z = -0.45
    wall.receiveShadow = true
    this.scene.add(wall)
    this.scene.add(this.group)
  }

  async init() {
    const input = await textPolygons(this.text, 3.4)
    const F = fractureIz(3.4, 0.42, 70, 5, input)
    this.pieces = F.pieces
    this.n = F.pieces.length
    this.data = new Float32Array(this.n * 2 * 4)
    for (let i = 0; i < this.n; i++) this.data[(this.n + i) * 4 + 3] = 1
    this.state = new THREE.DataTexture(this.data, this.n, 2, THREE.RGBAFormat, THREE.FloatType)
    this.disp = new Float32Array(this.n)
    this.t2 = new Float32Array(this.n)
    this.scatter = this.pieces.map((p) => new THREE.Vector3(p.cx * 2.2 + (Math.random() - 0.5) * 6, p.cy * 2 + 3 + Math.random() * 4, 2 + Math.random() * 6))
    this.phase = this.pieces.map(() => Math.random() * Math.PI * 2)
    // mármore claro com veios; as faces de quebra são mais foscas e um pouco mais escuras
    const mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.15 })
    mat.onBeforeCompile = (s) => {
      s.uniforms.uState = { value: this.state }
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\n' + HEAD)
        .replace('#include <beginnormal_vertex>', `vec4 qn = texelFetch(uState, ivec2(int(aPiece), 1), 0); vec3 objectNormal = qrot(qn, normal);`)
        .replace('#include <begin_vertex>', BEGIN)
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vLocal; varying vec3 vLN; varying float vGlow;
          float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
            return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
                       mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
          float fbm(vec3 p){ return n3(p) * 0.5 + n3(p * 2.1) * 0.25 + n3(p * 4.3) * 0.125 + n3(p * 8.7) * 0.0625; }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float side = smoothstep(0.6, 0.95, 1.0 - abs(normalize(vLN).z));
          float vein = 1.0 - smoothstep(0.0, 0.035, abs(sin((vLocal.x * 1.3 + vLocal.y * 0.7 + fbm(vLocal * 2.2) * 3.2) * 3.0)));
          vec3 marble = mix(vec3(0.95, 0.935, 0.91), vec3(0.62, 0.6, 0.58), vein * 0.55) * (0.96 + fbm(vLocal * 9.0) * 0.06);
          vec3 broken = vec3(0.83, 0.81, 0.78) * (0.9 + n3(vLocal * 120.0) * 0.15);
          diffuseColor.rgb = mix(marble, broken, side);`,
        )
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.22, 0.85, side);`)
        .replace('#include <clearcoat_fragment>', '#include <clearcoat_fragment>\n material.clearcoat *= (1.0 - side);')
    }
    const mesh = new THREE.Mesh(F.geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    dm.onBeforeCompile = (s) => {
      s.uniforms.uState = { value: this.state }
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + HEAD).replace('#include <begin_vertex>', BEGIN)
    }
    mesh.customDepthMaterial = dm
    this.group.add(mesh)
    this.ready = true
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
    this.group.scale.setScalar(Math.min(1, (w / h) * 0.75))
  }

  update(p: number, c: Ctx, rect: Rect) {
    if (!this.ready) return
    const m = this.local(c, rect)
    this.cam.position.set(m.x * 0.4, 0.2 + m.y * 0.2, 9.4 - p * 0.8)
    this.cam.lookAt(0, 0, 0)
    const build = fit(p, 0.05, 0.5)
    const leave = fit(p, 0.86, 1)
    let hov = 0
    if (m.inside && build > 0.98 && leave === 0) {
      this.ray.setFromCamera(new THREE.Vector2(m.x, m.y), this.cam)
      const hit = new THREE.Vector3()
      if (this.ray.ray.intersectPlane(this.plane, hit)) {
        hit.divideScalar(this.group.scale.x)
        this.mouse.lerp(hit, damp(0.3, c.dt))
        hov = 1
      }
    }
    const N = this.n
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    for (let i = 0; i < N; i++) {
      const pc = this.pieces[i]
      // encaixe de baixo para cima
      const k = ease(fit(build, pc.y01 * 0.6, pc.y01 * 0.6 + 0.4))
      const out = ease(fit(leave, (1 - pc.y01) * 0.5, (1 - pc.y01) * 0.5 + 0.5))
      const s = this.scatter[i]
      const d = Math.hypot(pc.cx - this.mouse.x, pc.cy - this.mouse.y)
      const t1 = hov * Math.max(0, 1 - d / 0.9) * (0.35 + pc.rand * 0.3)
      this.t2[i] += (t1 - this.t2[i]) * damp(0.08, c.dt)
      this.disp[i] += (this.t2[i] - this.disp[i]) * damp(0.07, c.dt)
      const di = this.disp[i]
      const away = 1 - k + out
      const ox = s.x * away + (pc.cx - this.mouse.x) * di * 0.4
      const oy = s.y * away * (out > 0 ? -0.6 : 1) + (pc.cy - this.mouse.y) * di * 0.4
      const oz = s.z * away + di * 0.9
      this.data.set([ox, oy, oz, di], i * 4)
      const rr = away * 3 + di * 1.2
      e.set(Math.cos(this.phase[i]) * rr, Math.sin(this.phase[i] * 1.3) * rr, Math.cos(this.phase[i] * 0.7) * rr * 0.5)
      q.setFromEuler(e)
      this.data.set([q.x, q.y, q.z, q.w], (N + i) * 4)
    }
    this.state.needsUpdate = true
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
