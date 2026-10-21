import * as THREE from 'three'
import { wordAtlas } from '../gl/wordSdf'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'
import { DISPLAY, raw, PAL } from './pal'

// Abertura: reação-difusão (Gray-Scott) viva. Duas "substâncias" reagem e se espalham; dentro das
// letras do Íz os parâmetros produzem um labirinto denso, fora delas o meio é estéril. O cursor
// pinga a substância B. Rolando, o meio de fora fica fértil e o padrão toma a tela inteira, a paleta
// gira, e no fim o lado de fora morre de novo e sobra só o nome.

const STEP = /* glsl */ `
  precision highp float;
  uniform sampler2D tPrev, tSdf;
  uniform vec2 uTexel, uMouse, uAspect;
  uniform float uFeedOut, uKillOut, uMouseOn, uSeed, uTime;
  uniform vec4 uCell; // x0, y0, w, h da palavra em uv
  varying vec2 vUv;
  float sdf(vec2 uv){
    vec2 q = (uv - uCell.xy) / uCell.zw;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 1.0;
    return texture2D(tSdf, q).r;
  }
  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec2 c = texture2D(tPrev, vUv).rg;
    // laplaciano 3x3
    vec2 lap = -c;
    lap += 0.2 * (texture2D(tPrev, vUv + vec2(uTexel.x, 0.)).rg + texture2D(tPrev, vUv - vec2(uTexel.x, 0.)).rg
                + texture2D(tPrev, vUv + vec2(0., uTexel.y)).rg + texture2D(tPrev, vUv - vec2(0., uTexel.y)).rg);
    lap += 0.05 * (texture2D(tPrev, vUv + uTexel).rg + texture2D(tPrev, vUv - uTexel).rg
                 + texture2D(tPrev, vUv + vec2(uTexel.x, -uTexel.y)).rg + texture2D(tPrev, vUv + vec2(-uTexel.x, uTexel.y)).rg);
    float d = sdf(vUv);
    float inside = 1.0 - smoothstep(-0.004, 0.006, d);
    // dentro: labirinto; fora: depende da rolagem (estéril → fértil → estéril)
    float F = mix(uFeedOut, 0.037, inside);
    float K = mix(uKillOut, 0.06, inside);
    float A = c.r, B = c.g;
    float abb = A * B * B;
    A += (1.0 * lap.r - abb + F * (1.0 - A));
    B += (0.5 * lap.g + abb - (K + F) * B);
    // gotas do cursor
    vec2 dm = (vUv - uMouse) * uAspect;
    B += uMouseOn * 0.5 * exp(-dot(dm, dm) / 0.00012);
    // sementes iniciais dentro das letras
    vec2 cellId = floor(vUv * vec2(90.0, 56.0));
    vec2 cellF = fract(vUv * vec2(90.0, 56.0)) - 0.5;
    if (uSeed > 0.0 && inside > 0.5 && h2(cellId) > 0.55 && length(cellF) < 0.3) B = 0.9;
    gl_FragColor = vec4(clamp(A, 0.0, 1.0), clamp(B, 0.0, 1.0), 0.0, 1.0);
  }`

const SHOW = /* glsl */ `
  precision highp float;
  uniform sampler2D tState;
  uniform vec2 uTexel;
  uniform vec3 uBg, uC1, uC2, uC3;
  uniform float uTime;
  varying vec2 vUv;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    float b = texture2D(tState, vUv).g;
    float bx = texture2D(tState, vUv + vec2(uTexel.x, 0.)).g - texture2D(tState, vUv - vec2(uTexel.x, 0.)).g;
    float by = texture2D(tState, vUv + vec2(0., uTexel.y)).g - texture2D(tState, vUv - vec2(0., uTexel.y)).g;
    // relevo: o padrão vira um esmalte em alto-relevo, iluminado de cima à esquerda
    vec3 n = normalize(vec3(-bx * 6.0, -by * 6.0, 1.0));
    float lam = dot(n, normalize(vec3(-0.5, 0.6, 0.65)));
    float t = smoothstep(0.12, 0.32, b);
    vec3 col = mix(uBg, uC1, t);
    col = mix(col, uC2, smoothstep(0.3, 0.45, b));
    col = mix(col, uC3, smoothstep(0.42, 0.55, b) * 0.6);
    col *= 0.86 + lam * 0.22 * t + (1.0 - t) * 0.14;
    col += pow(max(lam, 0.0), 24.0) * 0.18 * t;
    col += (h2(gl_FragCoord.xy + fract(uTime) * 71.0) - 0.5) * 0.025;
    gl_FragColor = vec4(col, 1.0);
  }`

export class RDSec extends Section {
  rts: THREE.WebGLRenderTarget[] = []
  i = 0
  step!: THREE.ShaderMaterial
  show!: THREE.ShaderMaterial
  init_!: THREE.ShaderMaterial
  quad = new Quad()
  ready = false
  seeded = 0
  mouse = new THREE.Vector2(-9, -9)

  constructor(el: HTMLElement, private word: string) {
    super(el)
  }

  async init() {
    await document.fonts.load(`800 120px ${DISPLAY}`)
    const atlas = wordAtlas([this.word], DISPLAY, 1024, 600, 800)
    this.step = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: STEP,
      depthTest: false,
      uniforms: {
        tPrev: { value: null },
        tSdf: { value: atlas.texture },
        uTexel: { value: new THREE.Vector2() },
        uMouse: { value: new THREE.Vector2(-9, -9) },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uFeedOut: { value: 0.01 },
        uKillOut: { value: 0.047 },
        uMouseOn: { value: 0 },
        uSeed: { value: 1 },
        uTime: { value: 0 },
        uCell: { value: new THREE.Vector4(0.1, 0.1, 0.8, 0.8) },
      },
    })
    this.show = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: SHOW,
      depthTest: false,
      uniforms: {
        tState: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uBg: { value: raw(PAL.cream) },
        uC1: { value: raw(PAL.cobalt) },
        uC2: { value: raw(PAL.tomato) },
        uC3: { value: raw(PAL.saffron) },
        uTime: { value: 0 },
      },
    })
    this.init_ = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: `void main(){ gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`,
      depthTest: false,
    })
    this.ready = true
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    // simulação em meia resolução: o padrão fica com grão de ~3 px na tela
    const W = Math.round(w / 1.7)
    const H = Math.round(h / 1.7)
    this.rts.forEach((r) => r.dispose())
    this.rts = [0, 1].map(() => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }))
    this.seeded = 0
    if (!this.step) return
    this.step.uniforms.uTexel.value.set(1 / W, 1 / H)
    this.show.uniforms.uTexel.value.set(1 / W, 1 / H)
    this.step.uniforms.uAspect.value.set(w / h, 1)
    // a palavra ocupa o centro, com a proporção do atlas (1024 x 600)
    const ww = Math.min(0.9, (h / w) * 1.35)
    const hh = (ww * (w / h)) / (1024 / 600)
    this.step.uniforms.uCell.value.set(0.5 - ww / 2, 0.5 - hh / 2, ww, hh)
  }

  update(p: number, c: Ctx, rect: Rect) {
    if (!this.ready || !this.rts.length) return
    const u = this.step.uniforms
    // estéril → fértil (o padrão invade) → estéril
    const grow = ease(fit(p, 0.25, 0.6)) * (1 - ease(fit(p, 0.72, 0.95)))
    u.uFeedOut.value = 0.02 + (0.0367 - 0.02) * grow
    u.uKillOut.value = 0.072 + (0.0649 - 0.072) * grow
    const m = this.local(c, rect)
    this.mouse.set((m.x + 1) / 2, (m.y + 1) / 2)
    u.uMouse.value.copy(this.mouse)
    u.uMouseOn.value += ((m.inside ? (c.ptr.down ? 1.6 : 0.5) : 0) - u.uMouseOn.value) * damp(0.2, c.dt)
    u.uTime.value = c.t
    // a paleta gira com a rolagem
    const s = this.show.uniforms
    const k = fit(p, 0.35, 0.75)
    s.uBg.value.copy(raw(PAL.cream).lerp(raw(PAL.cobalt), ease(k)))
    s.uC1.value.copy(raw(PAL.cobalt).lerp(raw(PAL.pink), ease(k)))
    s.uC2.value.copy(raw(PAL.tomato).lerp(raw(PAL.saffron), ease(k)))
    s.uC3.value.copy(raw(PAL.saffron).lerp(raw(PAL.cream), ease(k)))
    s.uTime.value = c.t
  }

  render(c: Ctx, rect: Rect) {
    if (!this.ready || !this.rts.length) return
    const r = c.r
    if (this.seeded === 0) {
      this.quad.draw(r, this.init_, this.rts[0])
      this.quad.draw(r, this.init_, this.rts[1])
    }
    const u = this.step.uniforms
    // vários passos por quadro: a reação anda rápido, mas estável
    for (let k = 0; k < 14; k++) {
      u.uSeed.value = this.seeded < 6 && k === 0 ? 1 : 0
      u.tPrev.value = this.rts[this.i].texture
      this.quad.draw(r, this.step, this.rts[1 - this.i])
      this.i = 1 - this.i
    }
    this.seeded++
    this.show.uniforms.tState.value = this.rts[this.i].texture
    this.quad.screen(c, rect, this.show)
  }
}
