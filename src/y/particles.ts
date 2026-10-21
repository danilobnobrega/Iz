import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { Section, damp, fit, toScreen, type Ctx, type Rect } from './core'

// "Como a gente pensa": cada princípio é escrito por ~65 mil grãos de tinta simulados na GPU.
// Rolando, os grãos se soltam da frase e se reorganizam na seguinte; o cursor sopra os grãos,
// que voltam ao lugar por mola.

const SIM_VEL = /* glsl */ `
  uniform sampler2D tA, tB, tSeed;
  uniform float uMix, uDt, uTime, uBurst, uMouseOn;
  uniform vec2 uMouse, uMouseVel;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec2 hash2(vec2 p){ return vec2(h(p), h(p + 17.1)) - 0.5; }
  // ruído de valor suave para um campo de redemoinho barato
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  vec2 curl(vec2 p){ float e = 0.05; return vec2(n(p + vec2(0, e)) - n(p - vec2(0, e)), -(n(p + vec2(e, 0)) - n(p - vec2(e, 0)))) / (2.0 * e); }
  void main(){
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 p = texture2D(tPos, uv);
    vec4 v = texture2D(tVel, uv);
    vec4 s = texture2D(tSeed, uv);
    float w = clamp(uMix * 1.7 - s.x * 0.7, 0.0, 1.0); w = w * w * (3.0 - 2.0 * w);
    vec3 tgt = mix(texture2D(tA, uv).xyz, texture2D(tB, uv).xyz, w);
    // no meio da troca, cada grão faz um arco (sobe e cai) em vez de ir reto
    float mid = sin(3.14159 * w) * (0.4 + s.y * 0.8);
    vec3 acc = (tgt + vec3(0.0, mid, 0.0) - p.xyz) * 9.0;
    acc.xy += curl(p.xy * 0.8 + uTime * 0.05) * (0.3 + uBurst * 6.0);
    vec2 d = p.xy - uMouse;
    float fall = exp(-dot(d, d) / 0.12) * uMouseOn;
    acc.xy += normalize(d + 1e-4) * fall * 14.0 + uMouseVel * fall * 3.0;
    v.xyz += acc * uDt;
    v.xyz *= pow(0.02, uDt);
    gl_FragColor = v;
  }`
const SIM_POS = /* glsl */ `
  uniform float uDt;
  void main(){ vec2 uv = gl_FragCoord.xy / resolution.xy; vec4 p = texture2D(tPos, uv); vec4 v = texture2D(tVel, uv);
    gl_FragColor = vec4(p.xyz + v.xyz * uDt, p.w); }`

export class ParticlesSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  gpu!: GPUComputationRenderer
  vPos!: Variable
  vVel!: Variable
  targets: THREE.DataTexture[] = []
  points!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  S = 256
  cur = 0
  mix = 1
  burst = 0
  mouse = new THREE.Vector2(99, 99)
  lastM = new THREE.Vector2()

  constructor(el: HTMLElement, private phrases: string[]) {
    super(el)
    this.scene.background = new THREE.Color('#e3e0db')
  }

  // amostra os grãos dentro de cada frase (texto em duas linhas, mundo de −1..1 em altura)
  sample(text: string) {
    const S = this.S
    const W = 2048
    const H = 900
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.fillStyle = '#000'
    x.fillRect(0, 0, W, H)
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    const words = text.split(' ')
    const half = Math.ceil(words.length / 2)
    const lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')]
    let size = 360
    x.font = `${size}px "Instrument Serif"`
    while (Math.max(...lines.map((l) => x.measureText(l).width)) > W * 0.92) {
      size -= 8
      x.font = `${size}px "Instrument Serif"`
    }
    lines.forEach((l, i) => x.fillText(l, W / 2, H / 2 + (i - 0.5) * size * 0.95))
    const d = x.getImageData(0, 0, W, H).data
    const inside: number[] = []
    for (let i = 0; i < W * H; i += 2) if (d[i * 4] > 140) inside.push(i)
    const out = new Float32Array(S * S * 4)
    for (let k = 0; k < S * S; k++) {
      const i = inside[Math.floor(Math.random() * inside.length)]
      const px = (i % W) + Math.random() - 0.5
      const py = Math.floor(i / W) + Math.random() - 0.5
      out.set([((px - W / 2) / H) * 2, -((py - H / 2) / H) * 2, (Math.random() - 0.5) * 0.02, 1], k * 4)
    }
    const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat, THREE.FloatType)
    t.needsUpdate = true
    return t
  }

  async init(r: THREE.WebGLRenderer) {
    const S = this.S
    this.targets = this.phrases.map((p) => this.sample(p))
    this.gpu = new GPUComputationRenderer(S, S, r)
    const p0 = this.gpu.createTexture()
    const seed = new Float32Array(S * S * 4)
    for (let i = 0; i < S * S; i++) {
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
      p0.image.data!.set([(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3 - 3, 0, Math.random()], i * 4)
    }
    const seedT = new THREE.DataTexture(seed, S, S, THREE.RGBAFormat, THREE.FloatType)
    seedT.needsUpdate = true
    this.vPos = this.gpu.addVariable('tPos', SIM_POS, p0)
    this.vVel = this.gpu.addVariable('tVel', SIM_VEL, this.gpu.createTexture())
    this.gpu.setVariableDependencies(this.vPos, [this.vPos, this.vVel])
    this.gpu.setVariableDependencies(this.vVel, [this.vPos, this.vVel])
    Object.assign(this.vVel.material.uniforms, {
      tA: { value: this.targets[0] },
      tB: { value: this.targets[0] },
      tSeed: { value: seedT },
      uMix: { value: 1 },
      uDt: { value: 1 / 60 },
      uTime: { value: 0 },
      uBurst: { value: 0 },
      uMouseOn: { value: 0 },
      uMouse: { value: new THREE.Vector2() },
      uMouseVel: { value: new THREE.Vector2() },
    })
    this.vPos.material.uniforms.uDt = { value: 1 / 60 }
    const err = this.gpu.init()
    if (err) console.error('[y] gpgpu', err)

    const ref = new Float32Array(S * S * 2)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) ref.set([(x + 0.5) / S, (y + 0.5) / S], (y * S + x) * 2)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * S * 3), 3))
    g.setAttribute('aRef', new THREE.BufferAttribute(ref, 2))
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        uniforms: { tPos: { value: null }, tVel: { value: null }, uSize: { value: 2 } },
        vertexShader: /* glsl */ `
          attribute vec2 aRef; uniform sampler2D tPos, tVel; uniform float uSize; varying float vA; varying float vS;
          void main(){
            vec4 p = texture2D(tPos, aRef);
            float sp = length(texture2D(tVel, aRef).xy);
            vS = sp;
            vA = 0.75 + p.w * 0.25;
            gl_PointSize = uSize * (0.75 + p.w * 0.6) * (1.0 + clamp(sp * 0.15, 0.0, 0.8));
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p.xyz, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying float vA; varying float vS;
          void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.25, d) * vA * (1.0 - clamp(vS * 0.05, 0.0, 0.5));
            gl_FragColor = vec4(0.09, 0.075, 0.06, a); }`,
      }),
    )
    this.points.frustumCulled = false
    this.scene.add(this.points)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const a = w / h
    const k = a < 1 ? 2.45 / a : 1.25
    this.cam.left = -a * k
    this.cam.right = a * k
    this.cam.top = k
    this.cam.bottom = -k
    this.cam.updateProjectionMatrix()
    if (this.points) this.points.material.uniforms.uSize.value = Math.max(1.6, Math.min(3, h / 380)) * dpr
  }

  update(p: number, c: Ctx, rect: Rect) {
    const n = this.phrases.length
    const want = Math.min(n - 1, Math.max(0, Math.floor(fit(p, 0.08, 0.92) * n)))
    const vu = this.vVel.material.uniforms
    if (want !== this.cur) {
      vu.tA.value = this.targets[this.cur]
      vu.tB.value = this.targets[want]
      this.cur = want
      this.mix = 0
      this.burst = 1
    }
    this.mix = Math.min(1, this.mix + c.dt / 1.3)
    this.burst = Math.max(0, this.burst - c.dt / 0.6)
    vu.uMix.value = this.mix
    vu.uBurst.value = this.burst * this.burst
    vu.uTime.value = c.t
    const dt = Math.min(c.dt, 1 / 30)
    vu.uDt.value = dt
    this.vPos.material.uniforms.uDt.value = dt
    const m = this.local(c, rect)
    const mx = m.x * this.cam.right
    const my = m.y * this.cam.top
    const vel = new THREE.Vector2(mx - this.lastM.x, my - this.lastM.y).divideScalar(Math.max(c.dt, 1e-3))
    this.lastM.set(mx, my)
    this.mouse.set(mx, my)
    vu.uMouse.value.copy(this.mouse)
    vu.uMouseVel.value.lerp(vel.clampLength(0, 8), damp(0.3, c.dt))
    vu.uMouseOn.value += ((m.inside ? 1 : 0) - vu.uMouseOn.value) * damp(0.1, c.dt)
    this.gpu.compute()
    this.points.material.uniforms.tPos.value = this.gpu.getCurrentRenderTarget(this.vPos).texture
    this.points.material.uniforms.tVel.value = this.gpu.getCurrentRenderTarget(this.vVel).texture
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
