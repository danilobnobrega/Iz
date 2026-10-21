import * as THREE from 'three'
import { wordAtlas } from '../gl/wordSdf'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'
import { DISPLAY, PAL, raw } from './pal'

// Op-art: a tela é feita de listras horizontais que correm. As frases não são desenhadas: são
// lugares onde as listras dobram meio período e trocam de cor, então só aparecem pelo contraste
// do padrão (como numa pintura da Bridget Riley). O cursor é uma lente que incha as listras.
// Rolando, uma frase se desfaz em ondas e a seguinte se forma.

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSdf;
  uniform vec2 uRes, uMouse, uOrigin;
  uniform float uTime, uA, uB, uMix, uCount, uDpr, uWave, uLens;
  uniform vec4 uCell;
  uniform vec3 uC1, uC2, uC3;
  varying vec2 vUv;
  float sdf(vec2 uv, float idx){
    vec2 q = (uv - uCell.xy) / uCell.zw;
    vec2 qc = clamp(q, 0.0, 1.0);
    float d = texture2D(tSdf, vec2(qc.x, (idx + qc.y * 0.998 + 0.001) / uCount)).r;
    return d + length(q - qc) * 0.5;
  }
  void main(){
    vec2 px = gl_FragCoord.xy - uOrigin;
    vec2 uv = px / uRes;
    float asp = uRes.x / uRes.y;
    // lente do cursor
    vec2 dm = (uv - uMouse) * vec2(asp, 1.0);
    float lens = exp(-dot(dm, dm) / 0.02) * uLens;
    float d = mix(sdf(uv, uA), sdf(uv, uB), uMix);
    float inside = 1.0 - smoothstep(-0.012, 0.012, d);
    float spacing = 14.0 * uDpr;
    // as listras correm e ondulam; dentro das letras, meio período de diferença
    float y = px.y + sin(px.x / uRes.x * 6.283 * 1.5 + uTime * 1.3) * 10.0 * uDpr * uWave;
    y += sin(px.x / uRes.x * 6.283 * 4.0 - uTime * 2.1 + px.y * 0.004) * 4.0 * uDpr * uWave;
    y -= lens * 40.0 * uDpr * sign(dm.y) * smoothstep(0.0, 0.2, abs(dm.y));
    y += uTime * 30.0 * uDpr;
    float ph = y / spacing + inside * 0.5;
    // listra com borda suave nas duas transições do período
    float tri = abs(fract(ph) - 0.5) * 2.0;
    float w = fwidth(ph) * 2.0;
    float stripe = smoothstep(0.5 - w, 0.5 + w, tri);
    vec3 a = mix(uC1, uC3, inside);
    vec3 col = mix(a, uC2, stripe);
    gl_FragColor = vec4(col, 1.0);
  }`

export class OpArtSec extends Section {
  mat!: THREE.ShaderMaterial
  quad = new Quad()
  cur = 0
  mix = 1
  from = 0
  mouse = new THREE.Vector2(-9, -9)

  constructor(el: HTMLElement, private phrases: string[]) {
    super(el)
  }

  async init() {
    await document.fonts.load(`800 120px ${DISPLAY}`)
    const atlas = wordAtlas(this.phrases, DISPLAY, 1600, 520, 800)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      extensions: { derivatives: true } as any,
      uniforms: {
        tSdf: { value: atlas.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uMouse: { value: new THREE.Vector2(-9, -9) },
        uTime: { value: 0 },
        uA: { value: 0 },
        uB: { value: 0 },
        uMix: { value: 0 },
        uCount: { value: this.phrases.length },
        uDpr: { value: 1 },
        uWave: { value: 1 },
        uLens: { value: 0 },
        uCell: { value: new THREE.Vector4(0.05, 0.2, 0.9, 0.6) },
        uC1: { value: raw(PAL.pink) },
        uC2: { value: raw(PAL.tomato) },
        uC3: { value: raw(PAL.cobalt) },
      },
    })
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uDpr.value = d
    u.uTime.value = c.t
    const asp = rect.w / rect.h
    const cw = Math.min(0.94, 0.94 * (asp / 1.6) * 1.7)
    const ch = (cw * asp) / (1600 / 520)
    u.uCell.value.set(0.5 - cw / 2, 0.5 - ch / 2, cw, ch)
    const n = this.phrases.length
    const k = Math.min(n - 1, Math.floor(fit(p, 0.0, 0.9) * n))
    if (k !== this.cur) {
      this.from = this.cur
      this.cur = k
      this.mix = 0
    }
    this.mix = Math.min(1, this.mix + c.dt / 0.9)
    u.uA.value = this.from
    u.uB.value = this.cur
    u.uMix.value = ease(this.mix)
    // na troca, as ondas ficam mais fortes
    u.uWave.value = 1 + Math.sin(Math.PI * this.mix) * 3
    const m = this.local(c, rect)
    this.mouse.set((m.x + 1) / 2, (m.y + 1) / 2)
    u.uMouse.value.copy(this.mouse)
    u.uLens.value += ((m.inside ? 1 : 0) - u.uLens.value) * damp(0.1, c.dt)
    // cada frase com o seu par de cores
    const pairs: [string, string, string][] = [
      [PAL.pink, PAL.tomato, PAL.cobalt],
      [PAL.saffron, PAL.ink, PAL.tomato],
      [PAL.pistachio, PAL.cobalt, PAL.cream],
      [PAL.cream, PAL.ink, PAL.saffron],
    ]
    const P = pairs[this.cur % pairs.length]
    u.uC1.value.lerp(raw(P[0]), damp(0.08, c.dt))
    u.uC2.value.lerp(raw(P[1]), damp(0.08, c.dt))
    u.uC3.value.lerp(raw(P[2]), damp(0.08, c.dt))
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
