import * as THREE from 'three'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from '../y/core'

// Fechamento: 520 velas sobre uma mesa comprida, arrumadas para formar "520" visto de cima.
// A câmera baixa e passeia rente à mesa: perto, as chamas tremem com detalhe; longe, viram discos
// de luz fora de foco. O cursor é um sopro: as chamas perto dele se inclinam e tremem mais.

const N = 520

const VERT = /* glsl */ `
  attribute vec4 aSeed; uniform float uTime, uFocus, uDpr, uH; uniform vec3 uWind;
  varying float vSeed; varying float vBlur; varying vec2 vLean; varying float vFlick;
  void main(){
    vec3 p = position;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    // fora de foco: o disco cresce com a distância ao plano de foco
    vBlur = clamp(abs(depth - uFocus) * 0.32, 0.0, 1.0);
    vSeed = aSeed.x;
    vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
    float w = exp(-dot(wp.xz - uWind.xy, wp.xz - uWind.xy) / 1.5) * uWind.z;
    vLean = vec2(sin(uTime * 3.0 + aSeed.y * 20.0) * 0.08 + w * 0.6, 0.0);
    vFlick = 0.85 + 0.15 * sin(uTime * (11.0 + aSeed.z * 9.0) + aSeed.w * 30.0) + w * 0.4 * sin(uTime * 40.0 + aSeed.x * 10.0);
    gl_PointSize = min(uH * (0.16 + vBlur * 0.3) / depth, uH * 0.12) * uDpr;
    gl_Position = projectionMatrix * mv;
  }`
const FRAG = /* glsl */ `
  varying float vSeed; varying float vBlur; varying vec2 vLean; varying float vFlick;
  void main(){
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    q.y = -q.y;
    // chama em gota: mais estreita em cima, inclinada pelo vento
    vec2 f = q;
    f.x -= vLean.x * (f.y + 1.0);
    f.y += 0.25;
    float wid = mix(0.32, 0.06, clamp((f.y + 0.6) / 1.4, 0.0, 1.0));
    float flame = smoothstep(wid, wid * 0.4, abs(f.x)) * smoothstep(-0.65, -0.45, f.y) * smoothstep(0.85, 0.3, f.y);
    float core = smoothstep(wid * 0.55, 0.0, abs(f.x)) * smoothstep(-0.55, -0.35, f.y) * smoothstep(0.2, -0.2, f.y);
    vec3 c = vec3(1.0, 0.55, 0.18) * flame * 1.4 + vec3(1.0, 0.92, 0.75) * core * 1.6;
    // longe do foco: disco macio com borda um pouco mais clara (bokeh)
    float r = length(q);
    float disk = smoothstep(1.0, 0.85, r) * (0.6 + 0.4 * smoothstep(0.5, 0.95, r));
    vec3 b = vec3(1.0, 0.68, 0.34) * disk * 0.1;
    vec3 col = mix(c, b, vBlur) * vFlick;
    float a = max(col.r, max(col.g, col.b));
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, 1.0);
  }`

function layout() {
  const W = 1000, H = 420
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.fillStyle = '#000'
  x.fillRect(0, 0, W, H)
  x.fillStyle = '#fff'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.font = `700 400px "Fraunces Variable"`
  x.fillText('520', W / 2, H / 2 + 20)
  const d = x.getImageData(0, 0, W, H).data
  let step = 20
  let pts: [number, number][] = []
  for (let it = 0; it < 30; it++) {
    pts = []
    for (let py = 0; py < H; py += step) for (let px = (Math.round(py / step) % 2) * step * 0.5; px < W; px += step) if (d[(Math.floor(py) * W + Math.floor(px)) * 4] > 128) pts.push([px, py])
    if (pts.length > N) step *= 1.03
    else if (pts.length < N * 0.98) step *= 0.97
    else break
  }
  return pts.slice(0, N).map(([px, py]) => new THREE.Vector3(((px - W / 2) / W) * 14, 0, ((py - H / 2) / W) * 14))
}

export class CandlesSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(40, 1, 0.05, 100)
  points!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  wind = new THREE.Vector3(99, 99, 0)
  ray = new THREE.Raycaster()

  constructor(el: HTMLElement) {
    super(el)
    this.scene.background = new THREE.Color('#070504')
    // mesa escura que reflete um pouco do calor das velas
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vW; void main(){ float r = length(vW.xz * vec2(0.14, 0.3)); vec3 c = vec3(0.11, 0.06, 0.03) * exp(-r * r * 1.6); gl_FragColor = vec4(c + vec3(0.012, 0.009, 0.007), 1.0); }`,
      }),
    )
    table.rotation.x = -Math.PI / 2
    table.position.y = -0.02
    this.scene.add(table)
  }

  async init() {
    await document.fonts.load('700 80px "Fraunces Variable"')
    const P = layout()
    const pos = new Float32Array(N * 3)
    const seed = new Float32Array(N * 4)
    P.forEach((v, i) => {
      pos.set([v.x + (Math.random() - 0.5) * 0.08, 0.18, v.z + (Math.random() - 0.5) * 0.08], i * 3)
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uFocus: { value: 6 }, uDpr: { value: 1 }, uH: { value: 900 }, uWind: { value: new THREE.Vector3(99, 99, 0) } },
      }),
    )
    this.points.frustumCulled = false
    this.scene.add(this.points)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 62 : 40
    this.cam.updateProjectionMatrix()
    if (this.points) this.points.material.uniforms.uH.value = h
  }

  update(p: number, c: Ctx, rect: Rect) {
    if (!this.points) return
    // de cima (lê-se 520) descendo para rente à mesa, passeando entre as velas
    const k = ease(fit(p, 0.15, 0.9))
    const top = new THREE.Vector3(0, 13, 4)
    const low = new THREE.Vector3(-6, 0.9, 5.5)
    this.cam.position.lerpVectors(top, low, k)
    this.cam.position.x += Math.sin(c.t * 0.2) * 0.3
    this.cam.lookAt(new THREE.Vector3(0, 0, 0).lerp(new THREE.Vector3(2, 0.3, -1), k))
    const u = this.points.material.uniforms
    u.uTime.value = c.t
    u.uDpr.value = c.dpr
    u.uFocus.value = 2 + (1 - k) * 11
    const m = this.local(c, rect)
    if (m.inside) {
      this.ray.setFromCamera(new THREE.Vector2(m.x, m.y), this.cam)
      const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.18), new THREE.Vector3())
      if (hit) this.wind.set(hit.x, hit.z, Math.min(1, Math.hypot(c.ptr.vx, c.ptr.vy) * 0.05 + 0.3))
    }
    this.wind.z *= Math.pow(0.95, c.dt * 60)
    u.uWind.value.copy(this.wind)
    void damp
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
