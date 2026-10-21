import * as THREE from 'three'
import { wordAtlas } from '../gl/wordSdf'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'

// "O nome": uma lâmina d'água sobre um piso escuro onde a frase está gravada. A superfície é uma
// simulação de ondas (equação da onda numa grade); a luz que atravessa a água se concentra onde a
// superfície curva, formando as cáusticas, calculadas pela variação de área dos raios refratados.
// O cursor mexe a água; a frase no fundo se deforma pela refração.

const WAVE = /* glsl */ `
  uniform sampler2D t; uniform vec2 uTexel, uDrop; uniform float uDropAmt, uDropR;
  varying vec2 vUv;
  void main(){
    vec4 s = texture2D(t, vUv);
    float avg = (texture2D(t, vUv + vec2(uTexel.x, 0.)).r + texture2D(t, vUv - vec2(uTexel.x, 0.)).r
               + texture2D(t, vUv + vec2(0., uTexel.y)).r + texture2D(t, vUv - vec2(0., uTexel.y)).r) * 0.25;
    float vel = s.g + (avg - s.r) * 1.9;
    vel *= 0.985;
    float h = s.r + vel;
    vec2 d = vUv - uDrop;
    h -= uDropAmt * exp(-dot(d, d) / (uDropR * uDropR));
    gl_FragColor = vec4(h * 0.999, vel, 0.0, 1.0);
  }`

const SHOW = /* glsl */ `
  uniform sampler2D tWave, tSdf; uniform vec2 uTexel, uRes, uOrigin; uniform float uTime, uLight;
  uniform vec4 uLine[2]; uniform float uCount;
  varying vec2 vUv;
  float word(vec2 uv, vec4 L, float idx){
    vec2 q = (uv - L.xy) / L.zw;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 1.0;
    return texture2D(tSdf, vec2(q.x, (idx + q.y * 0.998 + 0.001) / uCount)).r;
  }
  void main(){
    vec2 uv = (gl_FragCoord.xy - uOrigin) / uRes;
    float hx = texture2D(tWave, uv + vec2(uTexel.x, 0.)).r - texture2D(tWave, uv - vec2(uTexel.x, 0.)).r;
    float hy = texture2D(tWave, uv + vec2(0., uTexel.y)).r - texture2D(tWave, uv - vec2(0., uTexel.y)).r;
    vec2 g = vec2(hx, hy);
    // o fundo visto através da água: deslocado pela inclinação da superfície
    vec2 buv = uv + g * 0.35;
    float d = min(word(buv, uLine[0], 0.0), word(buv, uLine[1], 1.0));
    float ink = 1.0 - smoothstep(-0.003, 0.003, d);
    // cáusticas: a luz refratada converge onde a área do raio encolhe
    vec2 q = uv * uRes + g * uRes.y * 2.2;
    float area = abs(dFdx(q.x) * dFdy(q.y) - dFdx(q.y) * dFdy(q.x));
    float caus = clamp(1.0 / max(area, 0.08), 0.0, 6.0);
    vec3 floorc = mix(vec3(0.02, 0.06, 0.07), vec3(0.04, 0.11, 0.12), smoothstep(0.0, 1.0, uv.y));
    floorc = mix(floorc, vec3(0.86, 0.8, 0.66), ink * 0.85);
    vec3 light = vec3(1.0, 0.86, 0.6) * (caus - 1.0) * 0.6 * uLight;
    vec3 col = floorc * (0.8 + caus * 0.25 * uLight) + max(light, 0.0);
    // reflexo do céu na superfície onde ela inclina
    col += vec3(0.5, 0.65, 0.7) * pow(length(g) * 8.0, 2.0) * 0.08;
    gl_FragColor = vec4(col, 1.0);
  }`

export class CausticsSec extends Section {
  rts: THREE.WebGLRenderTarget[] = []
  wi = 0
  quad = new Quad()
  wave = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: WAVE, depthTest: false, uniforms: { t: { value: null }, uTexel: { value: new THREE.Vector2() }, uDrop: { value: new THREE.Vector2(-9, -9) }, uDropAmt: { value: 0 }, uDropR: { value: 0.01 } } })
  show!: THREE.ShaderMaterial
  last = new THREE.Vector2(-9, -9)
  rainT = 0

  constructor(el: HTMLElement, private lines: [string, string]) {
    super(el)
  }

  async init() {
    await document.fonts.load('400 80px "Fraunces Variable"')
    const atlas = wordAtlas(this.lines, '"Fraunces Variable", serif', 1600, 420, 300)
    this.show = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: SHOW,
      depthTest: false,
      extensions: { derivatives: true } as any,
      uniforms: {
        tWave: { value: null },
        tSdf: { value: atlas.texture },
        uTexel: { value: new THREE.Vector2() },
        uRes: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uLight: { value: 1 },
        uLine: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uCount: { value: 2 },
      },
    })
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const W = 384
    const H = Math.round((384 * h) / w)
    this.rts.forEach((r) => r.dispose())
    this.rts = [0, 1].map(() => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }))
    this.wave.uniforms.uTexel.value.set(1 / W, 1 / H)
    if (this.show) this.show.uniforms.uTexel.value.set(1.5 / W, 1.5 / H)
  }

  drop(x: number, y: number, amt: number, r: number, c: Ctx) {
    const u = this.wave.uniforms
    u.uDrop.value.set(x, y)
    u.uDropAmt.value = amt
    u.uDropR.value = r
    u.t.value = this.rts[this.wi].texture
    this.quad.draw(c.r, this.wave, this.rts[1 - this.wi])
    this.wi = 1 - this.wi
  }

  update(p: number, c: Ctx, rect: Rect) {
    const s = this.show.uniforms
    const d = c.dpr
    s.uRes.value.set(rect.w * d, rect.h * d)
    s.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    s.uTime.value = c.t
    s.uLight.value = ease(fit(p, 0.0, 0.25)) * (1 - fit(p, 0.9, 1) * 0.7)
    const asp = rect.w / rect.h
    const cw = Math.min(0.86, 0.86 * asp * 0.75)
    const ch = (cw * asp) / (1600 / 420)
    s.uLine.value[0].set(0.5 - cw / 2 - 0.02, 0.5, cw, ch)
    s.uLine.value[1].set(0.5 - cw / 2 + 0.04, 0.5 - ch * 0.95, cw, ch)
    void damp
  }

  render(c: Ctx, rect: Rect) {
    const m = this.local(c, rect)
    const mx = (m.x + 1) / 2, my = (m.y + 1) / 2
    // dois passos de simulação por quadro; o cursor arrasta a água, e cai uma gota de vez em quando
    for (let k = 0; k < 2; k++) {
      if (k === 0 && m.inside && this.last.distanceTo(new THREE.Vector2(mx, my)) > 0.002) this.drop(mx, my, 0.02, 0.012, c)
      else if (k === 1 && (this.rainT -= c.dt) < 0) {
        this.rainT = 0.35 + Math.random() * 0.9
        this.drop(Math.random(), Math.random(), 0.05, 0.008, c)
      } else this.drop(-9, -9, 0, 0.01, c)
    }
    this.last.set(mx, my)
    this.show.uniforms.tWave.value = this.rts[this.wi].texture
    this.quad.screen(c, rect, this.show)
  }
}
