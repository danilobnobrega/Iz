import * as THREE from 'three'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'

// "Alata, sorvete": um floco de neve crescendo de verdade, pelo modelo de Reiter (autômato numa
// grade hexagonal): células congeladas capturam vapor, o resto difunde. Com pouca captura nascem
// os galhos dendríticos de seis pontas. O cursor é um bafo: põe vapor no ar e o cristal cresce
// em direção a ele.

const N = 420

// grade hexagonal em coordenadas axiais: vizinhos (±1,0), (0,±1), (1,−1), (−1,1)
const PASS_A = /* glsl */ `
  uniform sampler2D tS; uniform float uGamma; uniform vec2 uMouse; uniform float uBreath;
  varying vec2 vUv;
  const float T = 1.0 / ${N}.0;
  float ice(vec2 o){ return step(1.0, texture2D(tS, vUv + o * T).r); }
  void main(){
    float s = texture2D(tS, vUv).r;
    float rec = max(ice(vec2(0.0)), max(max(ice(vec2(1,0)), ice(vec2(-1,0))), max(max(ice(vec2(0,1)), ice(vec2(0,-1))), max(ice(vec2(1,-1)), ice(vec2(-1,1))))));
    // bafo: mais vapor perto do cursor
    float br = exp(-dot(vUv - uMouse, vUv - uMouse) / 0.004) * uBreath * 0.004;
    float u = rec > 0.5 ? 0.0 : s + br;
    float v = rec > 0.5 ? s + uGamma : 0.0;
    gl_FragColor = vec4(u, v, 0.0, 1.0);
  }`
const PASS_B = /* glsl */ `
  uniform sampler2D tUV; uniform float uAlpha; uniform float uBeta;
  varying vec2 vUv;
  const float T = 1.0 / ${N}.0;
  float U(vec2 o){ vec2 q = vUv + o * T; if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return uBeta; return texture2D(tUV, q).r; }
  void main(){
    vec2 c = texture2D(tUV, vUv).rg;
    float avg = (U(vec2(1,0)) + U(vec2(-1,0)) + U(vec2(0,1)) + U(vec2(0,-1)) + U(vec2(1,-1)) + U(vec2(-1,1))) / 6.0;
    float u = c.r + uAlpha * 0.5 * (avg - c.r);
    gl_FragColor = vec4(u + c.g, 0.0, 0.0, 1.0);
  }`
const INIT = /* glsl */ `uniform float uBeta; varying vec2 vUv;
  void main(){ vec2 d = (vUv - 0.5) * ${N}.0; gl_FragColor = vec4(length(d) < 0.8 ? 1.0 : uBeta, 0.0, 0.0, 1.0); }`

const SHOW = /* glsl */ `
  precision highp float;
  uniform sampler2D tS; uniform vec2 uRes, uOrigin; uniform float uScale, uTime, uOn;
  varying vec2 vUv;
  float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec2 axial(vec2 p){ return vec2(0.57735 * p.x - 0.33333 * p.y, 0.66667 * p.y); }
  void main(){
    vec2 px = gl_FragCoord.xy - uOrigin - uRes * 0.5;
    vec2 a = axial(px / uScale);
    vec2 uv = a / ${N}.0 + 0.5;
    float s = texture2D(tS, uv).r;
    vec2 e = vec2(1.5 / ${N}.0, 0.0);
    float sx = texture2D(tS, uv + e.xy).r - texture2D(tS, uv - e.xy).r;
    float sy = texture2D(tS, uv + e.yx).r - texture2D(tS, uv - e.yx).r;
    float iceM = smoothstep(0.98, 1.02, s);
    // gelo: branco-azulado, com relevo pela variação de massa congelada dentro do cristal
    vec3 n = normalize(vec3(-sx * 4.0, -sy * 4.0, 1.0));
    float lam = dot(n, normalize(vec3(-0.4, 0.5, 0.75)));
    float depth = clamp((s - 1.0) * 1.6, 0.0, 1.0);
    vec3 ice = mix(vec3(0.62, 0.8, 0.98), vec3(0.97, 0.99, 1.0), depth) * (0.75 + 0.35 * lam);
    ice += pow(max(lam, 0.0), 30.0) * 0.5;
    // campo escuro azul profundo, vapor quase invisível
    vec3 bg = mix(vec3(0.02, 0.03, 0.08), vec3(0.05, 0.07, 0.16), 1.0 - length(px) / length(uRes));
    bg += vec3(0.1, 0.14, 0.25) * smoothstep(0.3, 0.6, s) * (1.0 - iceM) * 0.2;
    vec3 col = mix(bg, ice, iceM);
    col *= uOn;
    col += (h12(gl_FragCoord.xy + fract(uTime) * 13.0) - 0.5) * 0.02;
    gl_FragColor = vec4(col, 1.0);
  }`

export class SnowSec extends Section {
  quad = new Quad()
  s = [0, 1].map(() => new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }))
  uv = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
  si = 0
  a = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: PASS_A, depthTest: false, uniforms: { tS: { value: null }, uGamma: { value: 0.0006 }, uMouse: { value: new THREE.Vector2(-9, -9) }, uBreath: { value: 0 } } })
  b = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: PASS_B, depthTest: false, uniforms: { tUV: { value: null }, uAlpha: { value: 1.0 }, uBeta: { value: 0.4 } } })
  init_ = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: INIT, depthTest: false, uniforms: { uBeta: { value: 0.4 } } })
  show = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: SHOW, depthTest: false, uniforms: { tS: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uOrigin: { value: new THREE.Vector2() }, uScale: { value: 1 }, uTime: { value: 0 }, uOn: { value: 0 } } })
  started = false
  steps = 0
  budget = 0
  mouseUV = new THREE.Vector2(-9, -9)
  breath = 0

  update(p: number, c: Ctx, rect: Rect) {
    const d = c.dpr
    const u = this.show.uniforms
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    // o floco ocupa ~80% da menor dimensão da tela
    u.uScale.value = (Math.min(rect.w, rect.h) * d * 0.9) / (N * 0.866)
    u.uTime.value = c.t
    u.uOn.value = ease(fit(p, 0, 0.1)) * (1 - ease(fit(p, 0.94, 1)))
    // o crescimento acompanha a rolagem (e um pouco o tempo)
    const want = Math.floor(fit(p, 0.05, 0.85) * 5200) + Math.min(400, c.t * 0)
    this.budget = Math.max(0, want - this.steps)
    // cursor → coordenada axial da grade
    const m = this.local(c, rect)
    const px = m.x * rect.w * 0.5 * d, py = m.y * rect.h * 0.5 * d
    const sc = u.uScale.value
    const ax = (0.57735 * px - 0.33333 * py) / sc / N + 0.5
    const ay = (0.66667 * py) / sc / N + 0.5
    this.mouseUV.set(ax, ay)
    this.breath += ((m.inside ? 1 : 0) - this.breath) * damp(0.08, c.dt)
  }

  render(c: Ctx, rect: Rect) {
    const r = c.r
    if (!this.started) {
      this.quad.draw(r, this.init_, this.s[0])
      this.quad.draw(r, this.init_, this.s[1])
      this.started = true
    }
    this.a.uniforms.uMouse.value.copy(this.mouseUV)
    this.a.uniforms.uBreath.value = this.breath
    // passos por quadro: o que falta para alcançar a rolagem, no máximo 60; com cursor, sempre alguns
    const n = Math.min(60, this.budget + (this.breath > 0.1 ? 6 : 0))
    for (let k = 0; k < n; k++) {
      this.a.uniforms.tS.value = this.s[this.si].texture
      this.quad.draw(r, this.a, this.uv)
      this.b.uniforms.tUV.value = this.uv.texture
      this.quad.draw(r, this.b, this.s[1 - this.si])
      this.si = 1 - this.si
    }
    this.steps += Math.min(n, this.budget)
    this.show.uniforms.tS.value = this.s[this.si].texture
    this.quad.screen(c, rect, this.show)
  }
}
