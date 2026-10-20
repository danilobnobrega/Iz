import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

// Proposta S — "Poeira". Uma só matéria: partículas simuladas na GPU que formam a marca,
// as fotos em relevo (profundidade = luz do pixel) e as frases. Entre formas, a matéria vira fluxo.
// Cada partícula tem o seu atraso (progresso por partícula), então nada troca de uma vez.

THREE.ColorManagement.enabled = false

const noise = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
  vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
  vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
    float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
    return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
`

// mesma curva de atraso na simulação e no desenho
const stagger = /* glsl */ `
  float stagger(float r, float k) { return smoothstep(r * 0.55, r * 0.55 + 0.45, k); }
`

const velShader = /* glsl */ `
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uMix;
  uniform float uTime;
  uniform float uNoise;
  uniform float uSpring;
  uniform float uPush;
  uniform float uHold;
  uniform vec3 uMouse;
  ${noise}
  ${stagger}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 p = texture2D(tPos, uv).xyz;
    vec3 v = texture2D(tVel, uv).xyz;
    vec4 a = texture2D(tA, uv);
    vec4 b = texture2D(tB, uv);
    float r = a.w;
    float m = stagger(r, uMix);
    vec3 target = mix(a.xyz, b.xyz, m);
    vec3 acc = (target - p) * uSpring * (0.55 + r * 0.9);
    // no meio da troca, a partícula se solta e vira fluxo
    float loose = 4.0 * m * (1.0 - m);
    vec3 q = p * 0.0022 + vec3(0.0, 0.0, uTime * 0.07);
    vec3 flow = vec3(snoise(q), snoise(q + vec3(31.4, 7.1, 2.2)), snoise(q + vec3(-9.2, 17.3, 41.0)));
    acc += flow * (uNoise + loose * 2.4);
    // cursor: afasta; segurando, vira redemoinho que puxa
    vec3 d = p - uMouse;
    d.z *= 0.25;
    float dl = length(d) + 0.001;
    float rad = mix(72.0, 240.0, uHold);
    float f = exp(-dl * dl / (rad * rad));
    acc += (d / dl) * f * uPush * (1.0 - uHold * 1.6);
    acc += vec3(-d.y, d.x, d.z * 0.2) / dl * f * uHold * 3.2;
    v = v * 0.87 + acc;
    gl_FragColor = vec4(v, 1.0);
  }
`

const posShader = /* glsl */ `
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 p = texture2D(tPos, uv);
    p.xyz += texture2D(tVel, uv).xyz;
    gl_FragColor = p;
  }
`

const ptVert = /* glsl */ `
  attribute vec2 ref;
  uniform sampler2D tPos;
  uniform sampler2D tVel;
  uniform sampler2D tA;
  uniform sampler2D tCA;
  uniform sampler2D tCB;
  uniform float uMix;
  uniform float uSize;
  uniform float uPR;
  varying vec3 vCol;
  ${stagger}
  void main() {
    vec3 p = texture2D(tPos, ref).xyz;
    float r = texture2D(tA, ref).w;
    float m = stagger(r, uMix);
    vec3 c = mix(texture2D(tCA, ref).rgb, texture2D(tCB, ref).rgb, m);
    float sp = length(texture2D(tVel, ref).xyz);
    // rápido, a partícula esquenta
    vCol = c + vec3(1.0, 0.62, 0.34) * min(sp * 0.05, 0.55);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uPR * (1400.0 / -mv.z) * (1.0 + min(sp * 0.04, 0.9));
    gl_Position = projectionMatrix * mv;
  }
`

const ptFrag = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vCol;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.18, d);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vCol, a * uAlpha);
  }
`

const finalShader = {
  uniforms: { tDiffuse: { value: null }, uCA: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0.05 }, uFade: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uCA; uniform float uTime; uniform float uGrain; uniform float uFade;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float l = length(d);
      vec2 o = d * uCA * l;
      vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      c *= 1.0 - l * l * 0.85;
      float g = fract(sin(dot(vUv * vec2(1931.0, 1077.0) + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * uGrain;
      gl_FragColor = vec4(c * uFade, 1.0);
    }
  `,
}

export type Spec =
  | { kind: 'photo'; src: string; w: number; h: number; x: number; y: number; depth: number }
  | { kind: 'text'; lines: string[]; font: string; w: number; x: number; y: number; color: string; italic?: boolean }
  | { kind: 'galaxy'; r: number }

type Shape = { pos: THREE.DataTexture; col: THREE.DataTexture; relief: number }

export class Poeira {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(35, 1, 10, 6000)
  S: number
  N: number
  shapes: Shape[] = []
  mix = 0
  noise = 0.06
  spring = 0.022
  push = 5
  hold = 0
  dolly = 0
  orbit = new THREE.Vector2()
  mouse = new THREE.Vector3(9999, 9999, 0)
  burst = 0
  private gpu!: GPUComputationRenderer
  private vel!: Variable
  private pos!: Variable
  private points!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private rnd: Float32Array
  private cur = -1
  private composer!: EffectComposer
  bloom!: UnrealBloomPass
  final!: ShaderPass
  private ray = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  W = 1
  H = 1

  constructor(canvas: HTMLCanvasElement, small: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x0e0c0a, 1)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.S = small ? 256 : 420
    this.N = this.S * this.S
    this.rnd = new Float32Array(this.N)
    for (let i = 0; i < this.N; i++) this.rnd[i] = Math.random()
    this.resize()
  }

  // altura visível do mundo no plano z = 0
  get viewH() {
    return 900
  }
  get viewW() {
    return 900 * (this.W / this.H)
  }

  async build(specs: Spec[], onProgress: (p: number) => void) {
    for (let k = 0; k < specs.length; k++) {
      this.shapes.push(await this.shape(specs[k]))
      onProgress((k + 1) / specs.length)
    }
    this.initSim()
  }

  private tex(data: Float32Array | Uint8Array, float: boolean) {
    const t = new THREE.DataTexture(data, this.S, this.S, THREE.RGBAFormat, float ? THREE.FloatType : THREE.UnsignedByteType)
    t.minFilter = t.magFilter = THREE.NearestFilter
    t.needsUpdate = true
    return t
  }

  private async shape(s: Spec): Promise<Shape> {
    const N = this.N
    const pos = new Float32Array(N * 4)
    const col = new Uint8Array(N * 4)
    const put = (i: number, x: number, y: number, z: number, r: number, g: number, b: number) => {
      pos[i * 4] = x
      pos[i * 4 + 1] = y
      pos[i * 4 + 2] = z
      pos[i * 4 + 3] = this.rnd[i]
      col[i * 4] = r
      col[i * 4 + 1] = g
      col[i * 4 + 2] = b
      col[i * 4 + 3] = 255
    }
    let relief = 0
    if (s.kind === 'photo') {
      relief = 1
      const img = new Image()
      img.src = s.src
      await img.decode()
      const cw = 420
      const ch = Math.round((cw * s.h) / s.w)
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      const g = c.getContext('2d', { willReadFrequently: true })!
      const ia = img.width / img.height
      const ca = cw / ch
      const dw = ia > ca ? ch * ia : cw
      const dh = ia > ca ? ch : cw / ia
      g.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
      const d = g.getImageData(0, 0, cw, ch).data
      for (let i = 0; i < N; i++) {
        const u = Math.random()
        const v = Math.random()
        const k = (Math.min(ch - 1, (v * ch) | 0) * cw + Math.min(cw - 1, (u * cw) | 0)) * 4
        const r = d[k]
        const gg = d[k + 1]
        const b = d[k + 2]
        const lum = (0.3 * r + 0.59 * gg + 0.11 * b) / 255
        put(i, s.x + (u - 0.5) * s.w, s.y + (0.5 - v) * s.h, (lum - 0.5) * s.depth + (Math.random() - 0.5) * 6, r, gg, b)
      }
    } else if (s.kind === 'text') {
      const c = document.createElement('canvas')
      const g = c.getContext('2d', { willReadFrequently: true })!
      const fs = 220
      g.font = `${s.italic ? 'italic ' : ''}${s.font.replace('%', String(fs))}`
      const lw = Math.max(...s.lines.map((l) => g.measureText(l).width))
      const lh = fs * 0.98
      c.width = Math.ceil(lw + 40)
      c.height = Math.ceil(lh * s.lines.length + fs * 0.75)
      g.font = `${s.italic ? 'italic ' : ''}${s.font.replace('%', String(fs))}`
      g.fillStyle = '#fff'
      g.textBaseline = 'alphabetic'
      g.textAlign = 'center'
      s.lines.forEach((l, i) => g.fillText(l, c.width / 2, fs * 1.2 + i * lh))
      const d = g.getImageData(0, 0, c.width, c.height).data
      const hits: number[] = []
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 128) hits.push(x, y)
      const sc = s.w / c.width
      const base = new THREE.Color(s.color)
      for (let i = 0; i < N; i++) {
        const h = ((Math.random() * hits.length) / 2) | 0
        const x = (hits[h * 2] + Math.random() - c.width / 2) * sc
        const y = -(hits[h * 2 + 1] + Math.random() - c.height / 2) * sc
        const t = 0.82 + Math.random() * 0.18
        put(i, s.x + x, s.y + y, (Math.random() - 0.5) * 18, base.r * 255 * t, base.g * 255 * t, base.b * 255 * t)
      }
    } else {
      // um redemoinho lento: vinho no centro, creme nas bordas
      const inner = new THREE.Color('#7a2a1f')
      const outer = new THREE.Color('#9c8a74')
      const tmp = new THREE.Color()
      for (let i = 0; i < N; i++) {
        const k = Math.pow(Math.random(), 0.7)
        const arm = (i % 3) * ((Math.PI * 2) / 3)
        const a = arm + k * 5.2 + (Math.random() - 0.5) * 0.5 * (1 - k * 0.5)
        const rr = k * s.r + (Math.random() - 0.5) * 30
        tmp.copy(inner).lerp(outer, Math.min(1, k * 1.4))
        put(i, Math.cos(a) * rr, Math.sin(a) * rr * 0.62, (Math.random() - 0.5) * 70 * (1 - k), tmp.r * 255, tmp.g * 255, tmp.b * 255)
      }
    }
    return { pos: this.tex(pos, true), col: this.tex(col, false), relief }
  }

  private initSim() {
    const gpu = new GPUComputationRenderer(this.S, this.S, this.renderer)
    const p0 = gpu.createTexture()
    const v0 = gpu.createTexture()
    const pd = p0.image.data as unknown as Float32Array
    for (let i = 0; i < this.N; i++) {
      // começa como uma nuvem esférica larga, fora de quadro
      const u = Math.random() * 2 - 1
      const t = Math.random() * Math.PI * 2
      const r = 900 + Math.random() * 900
      const s = Math.sqrt(1 - u * u)
      pd[i * 4] = Math.cos(t) * s * r
      pd[i * 4 + 1] = Math.sin(t) * s * r
      pd[i * 4 + 2] = u * r - 400
      pd[i * 4 + 3] = this.rnd[i]
    }
    this.vel = gpu.addVariable('tVel', velShader, v0)
    this.pos = gpu.addVariable('tPos', posShader, p0)
    gpu.setVariableDependencies(this.vel, [this.pos, this.vel])
    gpu.setVariableDependencies(this.pos, [this.pos, this.vel])
    const vu = this.vel.material.uniforms
    Object.assign(vu, {
      tA: { value: this.shapes[0].pos },
      tB: { value: this.shapes[1].pos },
      uMix: { value: 0 },
      uTime: { value: 0 },
      uNoise: { value: 0 },
      uSpring: { value: 0 },
      uPush: { value: 0 },
      uHold: { value: 0 },
      uMouse: { value: this.mouse },
    })
    const err = gpu.init()
    if (err) throw new Error(err)
    this.gpu = gpu

    const geo = new THREE.BufferGeometry()
    const ref = new Float32Array(this.N * 2)
    for (let i = 0; i < this.N; i++) {
      ref[i * 2] = ((i % this.S) + 0.5) / this.S
      ref[i * 2 + 1] = (Math.floor(i / this.S) + 0.5) / this.S
    }
    geo.setAttribute('ref', new THREE.BufferAttribute(ref, 2))
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3))
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: ptVert,
        fragmentShader: ptFrag,
        transparent: true,
        depthWrite: false,
        uniforms: {
          tPos: { value: null },
          tVel: { value: null },
          tA: { value: this.shapes[0].pos },
          tCA: { value: this.shapes[0].col },
          tCB: { value: this.shapes[1].col },
          uMix: { value: 0 },
          uSize: { value: this.S > 300 ? 1.55 : 2.4 },
          uPR: { value: this.renderer.getPixelRatio() },
          uAlpha: { value: 0.92 },
        },
      }),
    )
    this.points.frustumCulled = false
    this.scene.add(this.points)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.W, this.H), 0.45, 0.7, 0.62)
    this.composer.addPass(this.bloom)
    this.final = new ShaderPass(finalShader)
    this.composer.addPass(this.final)
    this.resize()
  }

  // posição contínua na história: 0 = primeira forma, n-1 = última
  setStage(s: number, dwell = 0.24) {
    const n = this.shapes.length
    s = Math.max(0, Math.min(n - 1, s))
    const idx = Math.min(n - 2, Math.floor(s))
    const f = s - idx
    if (idx !== this.cur) {
      this.cur = idx
      const a = this.shapes[idx]
      const b = this.shapes[idx + 1]
      this.vel.material.uniforms.tA.value = a.pos
      this.vel.material.uniforms.tB.value = b.pos
      const pu = this.points.material.uniforms
      pu.tA.value = a.pos
      pu.tCA.value = a.col
      pu.tCB.value = b.col
    }
    const t = Math.max(0, Math.min(1, (f - dwell) / (1 - dwell * 2)))
    this.mix = t * t * (3 - 2 * t)
    this.burst = 4 * this.mix * (1 - this.mix)
    const ra = this.shapes[idx].relief
    const rb = this.shapes[idx + 1].relief
    return { idx, f, relief: ra + (rb - ra) * this.mix }
  }

  pointer(nx: number, ny: number) {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera)
    this.ray.ray.intersectPlane(this.plane, this.mouse)
  }

  resize() {
    this.W = window.innerWidth
    this.H = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.setSize(this.W, this.H, false)
    this.camera.aspect = this.W / this.H
    this.camera.updateProjectionMatrix()
    this.composer?.setSize(this.W, this.H)
    if (this.points) this.points.material.uniforms.uPR.value = this.renderer.getPixelRatio()
  }

  render(time: number, swing: number, ca: number) {
    const D = this.viewH / 2 / Math.tan(THREE.MathUtils.degToRad(17.5)) + this.dolly
    // a câmera gira na troca (revela o relevo) e acompanha o ponteiro
    const ax = this.orbit.x * 0.16 + swing
    const ay = this.orbit.y * 0.1
    this.camera.position.set(Math.sin(ax) * D, Math.sin(ay) * D, Math.cos(ax) * Math.cos(ay) * D)
    this.camera.lookAt(0, 0, 0)

    const vu = this.vel.material.uniforms
    vu.uMix.value = this.mix
    vu.uTime.value = time
    vu.uNoise.value = this.noise
    vu.uSpring.value = this.spring
    vu.uPush.value = this.push
    vu.uHold.value = this.hold
    this.gpu.compute()
    const pu = this.points.material.uniforms
    pu.tPos.value = this.gpu.getCurrentRenderTarget(this.pos).texture
    pu.tVel.value = this.gpu.getCurrentRenderTarget(this.vel).texture
    pu.uMix.value = this.mix
    this.final.uniforms.uCA.value = ca
    this.final.uniforms.uTime.value = time
    this.composer.render()
  }
}
