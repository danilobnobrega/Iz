import * as THREE from 'three'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from '../y/core'
import { DISPLAY, PAL, raw } from './pal'

// As casas: cada uma ocupa a tela inteira com a sua cor e o nome gigante, em letra condensada de
// gelatina. O nome é uma malha bem subdividida: o cursor arrasta a massa (que volta por mola, com
// um atraso que corre do ponto tocado para fora) e a rolagem estica e achata. A casa seguinte entra
// num círculo de borda ondulada que cresce a partir do cursor, e o nome novo cai e balança.

type House = { name: string; line: string; bg: string; fg: string; stripes?: string }
export const ZHOUSES: House[] = [
  { name: 'ÍZ', line: 'Contemporânea · Setor Marista · 2015', bg: PAL.cobalt, fg: PAL.cream },
  { name: '1929', line: 'Trattoria · o ano da avó, Dona Colombina', bg: PAL.tomato, fg: PAL.cream },
  { name: 'GRÁ', line: 'Bistrô francês · 192 m acima da cidade', bg: PAL.pistachio, fg: PAL.ink },
  { name: 'ALATA', line: 'Sorvete artesanal', bg: PAL.pink, fg: PAL.tomato },
  { name: 'FULLES', line: 'Cozinha na lenha', bg: PAL.saffron, fg: PAL.ink },
  { name: 'HOTEL', line: 'Íz Hotel · restaurant with rooms', bg: PAL.ink, fg: PAL.saffron },
  { name: 'NIP', line: 'Not in Napoli · Rua 1130', bg: PAL.cream, fg: PAL.cobalt, stripes: PAL.saffron },
]

const BG = /* glsl */ `
  uniform vec3 uA, uB, uSA, uSB; uniform float uStripeA, uStripeB, uIris, uTime; uniform vec2 uCenter, uRes;
  varying vec2 vUv;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 fill(vec3 c, vec3 s, float on, vec2 uv){
    // toldo listrado do nip, correndo devagar
    float st = step(0.5, fract((uv.x * uRes.x / uRes.y) * 7.0 + uTime * 0.05));
    return mix(c, s, st * on);
  }
  void main(){
    vec2 p = (vUv - uCenter) * vec2(uRes.x / uRes.y, 1.0);
    float a = atan(p.y, p.x);
    float r = length(p);
    float wav = sin(a * 9.0 + uTime * 4.0) * 0.025 + sin(a * 4.0 - uTime * 2.3) * 0.03;
    float inB = 1.0 - smoothstep(-0.002, 0.002, r - uIris * (1.0 + wav));
    vec3 col = mix(fill(uA, uSA, uStripeA, vUv), fill(uB, uSB, uStripeB, vUv), inB);
    col += (h2(gl_FragCoord.xy + fract(uTime) * 51.0) - 0.5) * 0.02;
    gl_FragColor = vec4(col, 1.0);
  }`

const TXT_VERT = /* glsl */ `
  uniform vec2 uWob, uMouse; uniform float uTime, uImp, uStretch, uDrop;
  varying vec2 vUv;
  void main(){
    vUv = uv;
    vec3 p = position;
    vec2 d = p.xy - uMouse;
    float dist = length(d);
    // a massa perto do cursor vai junto; o atraso cresce com a distância
    float fall = exp(-dist * dist / 3.5);
    p.xy += uWob * fall * (1.0 + 0.35 * sin(uTime * 12.0 - dist * 2.2));
    // queda e balanço quando a casa entra
    p.y += uDrop * 6.0;
    float jig = uImp * sin(uTime * 22.0 - p.x * 0.8) * exp(-abs(p.y) * 0.2);
    p.x += jig * 0.25;
    p.y *= 1.0 + uStretch + jig * 0.06;
    p.x *= 1.0 - uStretch * 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`
const TXT_FRAG = /* glsl */ `
  uniform sampler2D tMap; uniform vec3 uFg; uniform float uIrisMask, uIris, uTime; uniform vec2 uCenter, uRes, uOrigin;
  varying vec2 vUv;
  void main(){
    float a = texture2D(tMap, vUv).a;
    if (a < 0.01) discard;
    // o nome que entra só aparece dentro do círculo
    if (uIrisMask > 0.5) {
      vec2 suv = (gl_FragCoord.xy - uOrigin) / uRes;
      vec2 p = (suv - uCenter) * vec2(uRes.x / uRes.y, 1.0);
      float an = atan(p.y, p.x);
      float wav = sin(an * 9.0 + uTime * 4.0) * 0.025 + sin(an * 4.0 - uTime * 2.3) * 0.03;
      if (length(p) > uIris * (1.0 + wav)) discard;
    }
    gl_FragColor = vec4(uFg, a);
  }`

export class JellySec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  texts: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = []
  wob = new THREE.Vector2()
  wobV = new THREE.Vector2()
  lastM = new THREE.Vector2()
  cur = 0
  imp = 0
  drop = 0
  center = new THREE.Vector2(0.5, 0.5)
  stretch = 0
  lastP = 0
  cap: HTMLElement | null

  constructor(el: HTMLElement) {
    super(el)
    this.cap = el.querySelector('.z-house')
    this.bg = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.); }`,
        fragmentShader: BG,
        depthTest: false,
        uniforms: {
          uA: { value: raw(PAL.cobalt) },
          uB: { value: raw(PAL.cobalt) },
          uSA: { value: raw(PAL.cream) },
          uSB: { value: raw(PAL.cream) },
          uStripeA: { value: 0 },
          uStripeB: { value: 0 },
          uIris: { value: 0 },
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector2(0.5, 0.5) },
          uRes: { value: new THREE.Vector2(1, 1) },
        },
      }),
    )
    this.bg.frustumCulled = false
    this.bg.renderOrder = -1
    this.scene.add(this.bg)
    ZHOUSES.forEach((h) => {
      const cv = document.createElement('canvas')
      cv.width = 2400
      cv.height = 900
      const x = cv.getContext('2d')!
      x.fillStyle = '#fff'
      x.textAlign = 'center'
      x.textBaseline = 'alphabetic'
      let size = 900
      x.font = `900 ${size}px ${DISPLAY}`
      while (x.measureText(h.name).width > 2300) {
        size -= 10
        x.font = `900 ${size}px ${DISPLAY}`
      }
      x.fillText(h.name, 1200, 800)
      const tex = new THREE.CanvasTexture(cv)
      tex.anisotropy = 8
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 6, 160, 60),
        new THREE.ShaderMaterial({
          vertexShader: TXT_VERT,
          fragmentShader: TXT_FRAG,
          transparent: true,
          depthTest: false,
          uniforms: {
            tMap: { value: tex },
            uFg: { value: raw(h.fg) },
            uWob: { value: new THREE.Vector2() },
            uMouse: { value: new THREE.Vector2() },
            uTime: { value: 0 },
            uImp: { value: 0 },
            uStretch: { value: 0 },
            uDrop: { value: 0 },
            uIrisMask: { value: 0 },
            uIris: { value: 0 },
            uCenter: { value: new THREE.Vector2() },
            uRes: { value: new THREE.Vector2(1, 1) },
            uOrigin: { value: new THREE.Vector2() },
          },
        }),
      )
      m.visible = false
      this.scene.add(m)
      this.texts.push(m)
    })
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const a = w / h
    const k = a < 1 ? 9 / a : 5.2
    this.cam.left = -a * k
    this.cam.right = a * k
    this.cam.top = k
    this.cam.bottom = -k
    this.cam.updateProjectionMatrix()
  }

  update(p: number, c: Ctx, rect: Rect) {
    const n = ZHOUSES.length
    const raw_ = fit(p, 0.03, 0.97) * (n - 1)
    const i = Math.min(n - 2, Math.floor(raw_))
    const f = raw_ - i
    const iris = ease(fit(f, 0.55, 0.95))
    const A = ZHOUSES[i]
    const B = ZHOUSES[i + 1]
    const m = this.local(c, rect)
    if (f < 0.5) this.center.set(m.inside ? (m.x + 1) / 2 : 0.5, m.inside ? (m.y + 1) / 2 : 0.5)
    const bu = this.bg.material.uniforms
    bu.uA.value.copy(raw(A.bg))
    bu.uB.value.copy(raw(B.bg))
    bu.uSA.value.copy(raw(A.stripes ?? A.bg))
    bu.uSB.value.copy(raw(B.stripes ?? B.bg))
    bu.uStripeA.value = A.stripes ? 1 : 0
    bu.uStripeB.value = B.stripes ? 1 : 0
    const maxR = Math.hypot(rect.w / rect.h, 1) * 1.15
    bu.uIris.value = iris * maxR
    bu.uTime.value = c.t
    bu.uCenter.value.copy(this.center)
    bu.uRes.value.set(rect.w, rect.h)

    // mola do cursor
    const mx = m.x * this.cam.right
    const my = m.y * this.cam.top
    const vx = (mx - this.lastM.x) / Math.max(c.dt, 1e-3)
    const vy = (my - this.lastM.y) / Math.max(c.dt, 1e-3)
    this.lastM.set(mx, my)
    if (m.inside) {
      this.wobV.x += vx * 0.0025
      this.wobV.y += vy * 0.0025
    }
    this.wobV.x += -this.wob.x * 0.18 * (c.dt * 60)
    this.wobV.y += -this.wob.y * 0.18 * (c.dt * 60)
    this.wobV.multiplyScalar(Math.pow(0.86, c.dt * 60))
    this.wob.addScaledVector(this.wobV, c.dt * 60)
    this.wob.clampLength(0, 2.5)
    // a velocidade da rolagem estica o nome
    const sv = (p - this.lastP) / Math.max(c.dt, 1e-3)
    this.lastP = p
    this.stretch += (Math.max(-0.3, Math.min(0.3, sv * 1.2)) - this.stretch) * damp(0.15, c.dt)
    // a casa nova cai e balança quando o círculo fecha
    const landing = fit(f, 0.6, 1.0)
    this.drop = 1 - ease(landing)
    if (landing >= 1 && this.cur !== i + 1) {
      this.cur = i + 1
      this.imp = 1
    }
    if (landing < 0.5 && this.cur === i + 1) this.cur = i
    this.imp *= Math.pow(0.9, c.dt * 60)
    const d = c.dpr
    this.texts.forEach((t, k) => {
      const on = k === i || k === i + 1
      t.visible = on
      if (!on) return
      const u = t.material.uniforms
      u.uWob.value.copy(this.wob)
      u.uMouse.value.set(mx, my)
      u.uTime.value = c.t
      u.uStretch.value = this.stretch
      u.uImp.value = k === i + 1 && landing >= 1 ? this.imp : k === i && f < 0.05 ? this.imp : 0
      u.uDrop.value = k === i + 1 ? this.drop : 0
      u.uIrisMask.value = k === i + 1 ? 1 : 0
      u.uIris.value = iris * maxR
      u.uCenter.value.copy(this.center)
      u.uRes.value.set(rect.w * d, rect.h * d)
      u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
      t.renderOrder = k === i + 1 ? 2 : 1
      const s = rect.w / rect.h < 1 ? 1.4 : 1
      t.scale.setScalar(s)
    })
    const showI = f > 0.8 ? i + 1 : i
    if (this.cap && this.cap.dataset.i !== String(showI)) {
      this.cap.dataset.i = String(showI)
      const h = ZHOUSES[showI]
      const target = this.cap.querySelector<HTMLElement>('.y-in') ?? this.cap
      target.innerHTML = `${String(showI + 1).padStart(2, '0')} / 07 · ${h.line}`
      this.cap.style.color = h.fg
    }
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
