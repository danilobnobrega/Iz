import * as THREE from 'three'
import { Fluid } from './Fluid'
import { pointer } from '../ui/pointer'

THREE.ColorManagement.enabled = false

const displayVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// composição: a foto atual e a próxima, deformadas pela velocidade do fluido,
// misturadas pela tinta; a borda da tinta ganha uma linha escura e uma leve aberração
const displayFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tCur;
  uniform sampler2D tNext;
  uniform sampler2D tVel;
  uniform sampler2D tDye;
  uniform vec2 uRes;
  uniform float uCurAspect;
  uniform float uNextAspect;
  uniform float uCurZoom;
  uniform float uNextZoom;
  uniform float uDisp;
  uniform float uTime;
  uniform float uDark;
  uniform vec3 uInk;
  varying vec2 vUv;

  vec2 cover(vec2 uv, float imgAspect, float zoom) {
    float sa = uRes.x / uRes.y;
    vec2 s = sa > imgAspect ? vec2(1.0, imgAspect / sa) : vec2(sa / imgAspect, 1.0);
    return (uv - 0.5) * s / zoom + 0.5;
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    // velocidade suavizada (5 amostras) pra deformação não serrilhar
    vec2 px = 1.5 / uRes;
    vec2 vel = texture2D(tVel, vUv).xy * 0.4
      + texture2D(tVel, vUv + vec2(px.x, 0.0)).xy * 0.15 + texture2D(tVel, vUv - vec2(px.x, 0.0)).xy * 0.15
      + texture2D(tVel, vUv + vec2(0.0, px.y)).xy * 0.15 + texture2D(tVel, vUv - vec2(0.0, px.y)).xy * 0.15;
    vec2 off = vel * uDisp;
    float ol = length(off);
    off *= min(ol, 0.03) / max(ol, 1e-5);
    float m = texture2D(tDye, vUv).r;
    // borda da tinta com textura de papel
    float grain = hash(floor(vUv * uRes * 0.5)) * 0.08;
    float mm = smoothstep(0.42, 0.58, m + grain - 0.04);

    vec2 uc = cover(vUv - off, uCurAspect, uCurZoom);
    vec2 un = cover(vUv - off * 0.6, uNextAspect, uNextZoom);
    float ab = min(length(off), 0.02) * 0.06;
    vec3 a = vec3(texture2D(tCur, uc + vec2(ab, 0.0)).r, texture2D(tCur, uc).g, texture2D(tCur, uc - vec2(ab, 0.0)).b);
    vec3 b = vec3(texture2D(tNext, un + vec2(ab, 0.0)).r, texture2D(tNext, un).g, texture2D(tNext, un - vec2(ab, 0.0)).b);
    vec3 col = mix(a, b, mm);

    // linha de tinta na frente da revelação
    float edge = 1.0 - abs(mm * 2.0 - 1.0);
    col = mix(col, uInk, pow(edge, 3.0) * 0.85);

    // gradação: escurece pra leitura do texto e vinheta suave
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l), 0.12);
    col *= mix(1.0, 0.55, uDark * smoothstep(0.55, 0.0, vUv.y));
    col *= 1.0 - uDark * 0.25;
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.55;
    col += (hash(vUv * uRes + uTime) - 0.5) * 0.045;

    gl_FragColor = vec4(col, 1.0);
  }
`

export type Plate = { tex: THREE.Texture; aspect: number }

export class InkStage {
  renderer: THREE.WebGLRenderer
  fluid: Fluid
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private mat: THREE.ShaderMaterial
  private w = 1
  private h = 1
  private last = new THREE.Vector2(-1, -1)
  private clock = new THREE.Clock()

  // transição em curso
  private cur: Plate | null = null
  private next: Plate | null = null
  private t = -1
  private dir = 1
  private curZoom = { v: 1 }
  private nextZoom = 1
  dark = 1

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.autoClear = false
    this.fluid = new Fluid(this.renderer, { simRes: 160, dyeRes: 720, velocityDissipation: 0.9, dyeDissipation: 0, pressureIterations: 22, curl: 5 })
    this.mat = new THREE.ShaderMaterial({
      vertexShader: displayVert,
      fragmentShader: displayFrag,
      uniforms: {
        tCur: { value: null },
        tNext: { value: null },
        tVel: { value: null },
        tDye: { value: null },
        uRes: { value: new THREE.Vector2() },
        uCurAspect: { value: 1 },
        uNextAspect: { value: 1 },
        uCurZoom: { value: 1 },
        uNextZoom: { value: 1 },
        uDisp: { value: 0.00007 },
        uTime: { value: 0 },
        uDark: { value: 1 },
        uInk: { value: new THREE.Color('#141210') },
      },
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    quad.frustumCulled = false
    this.scene.add(quad)
    this.resize()
  }

  resize() {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.setSize(this.w, this.h, false)
    this.fluid.resize(this.w, this.h)
    this.mat.uniforms.uRes.value.set(this.w, this.h)
    // depois de redimensionar a tinta zera: mostra a placa atual por inteiro
    if (this.t >= 0 && this.next) this.finish()
  }

  setPlate(p: Plate) {
    this.cur = p
    this.mat.uniforms.tCur.value = p.tex
    this.mat.uniforms.uCurAspect.value = p.aspect
    this.mat.uniforms.tNext.value = p.tex
    this.mat.uniforms.uNextAspect.value = p.aspect
    this.fluid.clearDye(0)
  }

  // começa a revelar `p` como tinta; dir 1 = vindo de baixo, -1 = de cima
  reveal(p: Plate, dir: number) {
    if (this.t >= 0 && this.next) this.finish()
    if (this.cur === p) return
    this.next = p
    this.dir = dir
    this.t = 0
    this.nextZoom = 1.12
    this.mat.uniforms.tNext.value = p.tex
    this.mat.uniforms.uNextAspect.value = p.aspect
    this.fluid.clearDye(0)
  }

  private finish() {
    if (!this.next) return
    this.cur = this.next
    this.curZoom.v = this.nextZoom
    this.next = null
    this.t = -1
    this.mat.uniforms.tCur.value = this.cur.tex
    this.mat.uniforms.uCurAspect.value = this.cur.aspect
    this.fluid.clearDye(0)
  }

  render(dt: number, scrollVel: number) {
    const time = this.clock.getElapsedTime()
    const f = this.fluid

    // cursor: força proporcional ao movimento
    const p = pointer.uv
    if (this.last.x >= 0) {
      const dx = p.x - this.last.x
      const dy = p.y - this.last.y
      if (Math.abs(dx) + Math.abs(dy) > 0.00001) f.splatVelocity(p.x, p.y, dx * 9000, dy * 9000, 0.0022)
    }
    this.last.copy(p)

    // a rolagem empurra o fluido de leve na direção do scroll
    if (Math.abs(scrollVel) > 0.5) {
      const v = Math.max(-60, Math.min(60, scrollVel)) * 9
      for (let i = 0; i < 3; i++) f.splatVelocity(Math.random(), this.dir > 0 ? 0.04 : 0.96, (Math.random() - 0.5) * 80, v, 0.02)
    }

    // revelação: uma frente de tinta atravessa a tela empurrada pelo próprio fluido
    if (this.t >= 0 && this.next) {
      this.t += dt
      const T = this.t
      if (T < 1.5) {
        const front = Math.min(1, T / 1.15)
        const y = this.dir > 0 ? -0.05 + front * 1.1 : 1.05 - front * 1.1
        const n = 7
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) / n + (Math.random() - 0.5) * 0.12
          const yy = y + (Math.random() - 0.5) * 0.08
          f.splatDye(x, yy, 0.5, 0.006 + Math.random() * 0.008)
          f.splatVelocity(x, yy, (Math.random() - 0.5) * 260, this.dir * (380 + Math.random() * 240), 0.014)
        }
      }
      if (T > 1.05) f.scaleDye(1, dt * 1.2 * Math.min(1, (T - 1.05) / 0.6))
      if (T > 2.4) this.finish()
    }

    f.step(Math.min(dt, 1 / 30))

    // leve aproximação contínua das fotos
    this.curZoom.v += (1.0 - this.curZoom.v) * (1 - Math.pow(0.6, dt))
    this.nextZoom += (1.0 - this.nextZoom) * (1 - Math.pow(0.35, dt))
    const u = this.mat.uniforms
    u.uCurZoom.value = this.curZoom.v + Math.sin(time * 0.15) * 0.01
    u.uNextZoom.value = this.nextZoom
    u.tVel.value = f.velocity.read.texture
    u.tDye.value = f.dye.read.texture
    u.uTime.value = time
    u.uDark.value += (this.dark - u.uDark.value) * (1 - Math.pow(0.05, dt))

    this.renderer.setRenderTarget(null)
    this.renderer.render(this.scene, this.camera)
  }
}
