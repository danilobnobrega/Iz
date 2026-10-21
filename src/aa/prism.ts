import * as THREE from 'three'
import { wordAtlas } from '../gl/wordSdf'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'

// "Como a gente pensa": um feixe branco atravessa a névoa e entra num prisma de vidro; do outro
// lado sai um leque de cores. A frase está escrita na parede da direita, mas só aparece onde o
// leque a ilumina, então cada palavra fica de uma cor. O cursor gira o prisma e o leque varre a
// parede; rolando, troca a frase.

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSdf; uniform float uCount, uA, uB, uMix, uRot, uTime, uOn;
  uniform vec2 uRes, uOrigin; uniform vec4 uCell;
  varying vec2 vUv;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  vec3 spectrum(float x){ // 0 = vermelho, 1 = violeta
    vec3 c = clamp(vec3(1.5 - abs(4.0 * x - 0.6), 1.5 - abs(4.0 * x - 2.0), 1.5 - abs(4.0 * x - 3.4)), 0.0, 1.0);
    return c * c;
  }
  float sdf(vec2 uv, float idx){
    vec2 q = (uv - uCell.xy) / uCell.zw;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 1.0;
    return texture2D(tSdf, vec2(q.x, (idx + q.y * 0.998 + 0.001) / uCount)).r;
  }
  float tri(vec2 p, float r){ // triângulo equilátero (distância)
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r; p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }
  void main(){
    vec2 px = gl_FragCoord.xy - uOrigin;
    float asp = uRes.x / uRes.y;
    vec2 uv = px / uRes;
    vec2 p = (uv - vec2(0.36, 0.5)) * vec2(asp, 1.0);
    // prisma girado
    float c = cos(uRot), s = sin(uRot);
    vec2 pr = mat2(c, -s, s, c) * p;
    float dp = tri(pr, 0.14);
    vec3 col = vec3(0.012, 0.011, 0.014);
    // névoa
    float haze = 0.6 + 0.4 * n2(uv * vec2(4.0, 8.0) + vec2(uTime * 0.04, 0.0));
    // feixe branco de entrada (vem da esquerda, levemente de cima)
    vec2 inDir = normalize(vec2(1.0, -0.18));
    vec2 entry = vec2(-0.09, 0.02);
    vec2 rel = p - entry;
    float along = dot(rel, inDir);
    float across = abs(rel.x * inDir.y - rel.y * inDir.x);
    float beamIn = along < 0.0 ? exp(-across * across / 0.00008) : 0.0;
    col += vec3(1.0) * beamIn * 0.35 * haze * uOn;
    // leque de saída: ângulo a partir do ponto de saída decide a cor
    vec2 exitP = vec2(0.08, -0.02);
    vec2 q = p - exitP;
    float ang = atan(q.y, q.x);
    float center = -0.15 + uRot * 0.9;
    float spread = 0.28;
    float t = (ang - (center - spread * 0.5)) / spread;
    float inFan = smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.97, t) * step(0.0, q.x) * step(0.0, dp);
    vec3 sc = spectrum(clamp(t, 0.0, 1.0));
    float fall = 1.0 / (1.0 + length(q) * 1.5);
    col += sc * inFan * fall * 0.22 * haze * uOn;
    // a frase na parede, só onde o leque bate
    float dA = sdf(uv, uA), dB = sdf(uv, uB);
    float d = mix(dA, dB, uMix);
    float ink = 1.0 - smoothstep(-0.003, 0.003, d);
    col += sc * inFan * ink * 2.2 * uOn;
    col += ink * 0.012;
    // o prisma: vidro com bordas que acendem e um brilho interno
    float edge = exp(-abs(dp) * 140.0);
    float inside = 1.0 - smoothstep(-0.002, 0.002, dp);
    col = mix(col, col * 0.6 + vec3(0.05, 0.055, 0.06), inside);
    col += vec3(0.9, 0.95, 1.0) * edge * 0.6;
    col += vec3(1.0) * inside * exp(-abs(dot(pr, vec2(0.0, 1.0)) - 0.0) * 30.0) * 0.08 * uOn;
    col = col / (1.0 + col);
    col = pow(col, vec3(1.0 / 2.0));
    col += (h2(gl_FragCoord.xy + fract(uTime) * 31.0) - 0.5) * 0.025;
    gl_FragColor = vec4(col, 1.0);
  }`

export class PrismSec extends Section {
  mat!: THREE.ShaderMaterial
  quad = new Quad()
  cur = 0
  from = 0
  mix = 1
  rot = 0

  constructor(el: HTMLElement, private phrases: string[]) {
    super(el)
  }

  async init() {
    await document.fonts.load('400 80px "Fraunces Variable"')
    const atlas = wordAtlas(this.phrases, '"Fraunces Variable", serif', 1500, 380, 500)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        tSdf: { value: atlas.texture },
        uCount: { value: this.phrases.length },
        uA: { value: 0 },
        uB: { value: 0 },
        uMix: { value: 0 },
        uRot: { value: 0 },
        uTime: { value: 0 },
        uOn: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uCell: { value: new THREE.Vector4(0.48, 0.3, 0.5, 0.4) },
      },
    })
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uTime.value = c.t
    const asp = rect.w / rect.h
    const cw = 0.5
    const ch = (cw * asp) / (1500 / 380)
    u.uCell.value.set(0.47, 0.5 - ch / 2, cw, ch)
    const n = this.phrases.length
    const k = Math.min(n - 1, Math.floor(fit(p, 0.05, 0.93) * n))
    if (k !== this.cur) {
      this.from = this.cur
      this.cur = k
      this.mix = 0
    }
    this.mix = Math.min(1, this.mix + c.dt / 0.8)
    u.uA.value = this.from
    u.uB.value = this.cur
    u.uMix.value = ease(this.mix)
    u.uOn.value = ease(fit(p, 0.0, 0.08)) * (1 - ease(fit(p, 0.95, 1)))
    const m = this.local(c, rect)
    // sem mouse, o prisma oscila devagar e o leque varre a frase
    const want = m.inside ? m.y * 0.35 + 0.05 : Math.sin(c.t * 0.5) * 0.18 + 0.05
    this.rot += (want - this.rot) * damp(0.06, c.dt)
    u.uRot.value = this.rot
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
