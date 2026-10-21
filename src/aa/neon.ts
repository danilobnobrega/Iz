import * as THREE from 'three'
import { wordAtlas } from '../gl/wordSdf'
import { Section, Quad, FS_VERT, damp, fit, type Ctx, type Rect } from '../y/core'

// "A trajetória": letreiros de neon numa parede de tijolo, um por lugar. O tubo é o contorno da
// letra (campo de distância): núcleo quase branco, vidro colorido e halo. Cada letreiro liga com
// o tremido de um reator velho; o chão molhado reflete tudo com ondulação. O cursor perto do tubo
// faz ele chiar (tremida curta).

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSdf; uniform float uCount, uIdx, uPrev, uOn, uPrevOn, uTime, uBuzz;
  uniform vec2 uRes, uOrigin, uMouse; uniform vec3 uCol, uPrevCol; uniform vec4 uCell;
  varying vec2 vUv;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  float sdf(vec2 uv, float idx){
    vec2 q = (uv - uCell.xy) / uCell.zw;
    vec2 qc = clamp(q, 0.0, 1.0);
    return texture2D(tSdf, vec2(qc.x, (idx + qc.y * 0.998 + 0.001) / uCount)).r + length(q - qc) * 0.3;
  }
  vec3 neon(vec2 uv, float idx, vec3 c, float on){
    float d = abs(sdf(uv, idx)) ;
    float tube = exp(-pow(d / 0.0055, 2.0));
    float glass = exp(-pow(d / 0.012, 2.0));
    float halo = exp(-d / 0.05) * 0.35 + exp(-d / 0.15) * 0.12;
    return (vec3(1.0, 0.97, 0.92) * tube * 1.2 + c * glass * 1.4 + c * halo) * on;
  }
  vec3 bricks(vec2 uv){
    vec2 b = uv * vec2(14.0, 28.0) * vec2(uRes.x / uRes.y, 1.0) * 0.5;
    b.x += step(1.0, mod(floor(b.y), 2.0)) * 0.5;
    vec2 f = fract(b);
    float mortar = smoothstep(0.0, 0.06, f.x) * smoothstep(1.0, 0.94, f.x) * smoothstep(0.0, 0.1, f.y) * smoothstep(1.0, 0.9, f.y);
    float tone = 0.6 + 0.4 * h2(floor(b));
    return vec3(0.075, 0.045, 0.04) * tone * (0.55 + 0.45 * mortar) * (0.8 + 0.2 * n2(uv * 60.0));
  }
  vec3 scene(vec2 uv){
    vec3 col = bricks(uv);
    vec3 light = neon(uv, uIdx, uCol, uOn) + neon(uv, uPrev, uPrevCol, uPrevOn);
    // a parede pega a cor do letreiro
    vec3 wash = (uCol * uOn + uPrevCol * uPrevOn) * 0.05;
    return col + col * (light * 6.0 + wash * 20.0) + light;
  }
  void main(){
    vec2 uv = (gl_FragCoord.xy - uOrigin) / uRes;
    float horizon = 0.3;
    vec3 col;
    if (uv.y > horizon) col = scene(uv);
    else {
      // chão molhado: reflexo espelhado com ondulação e escurecido
      float k = (horizon - uv.y);
      vec2 r = vec2(uv.x, horizon + k);
      r.x += (n2(vec2(uv.x * 40.0, uv.y * 160.0 - uTime * 2.0)) - 0.5) * 0.012 * (1.0 + k * 6.0);
      r.y += (n2(vec2(uv.x * 9.0, uv.y * 60.0 + uTime)) - 0.5) * 0.02 * k * 4.0;
      col = scene(r) * 0.42 * (1.0 - k * 1.2);
      col += vec3(0.02, 0.02, 0.025);
      col *= 0.8 + 0.2 * n2(uv * vec2(80.0, 300.0));
    }
    col = col / (1.0 + col * 0.6);
    col = pow(col, vec3(1.0 / 1.6));
    col += (h2(gl_FragCoord.xy + fract(uTime) * 41.0) - 0.5) * 0.025;
    gl_FragColor = vec4(col, 1.0);
  }`

const SIGNS: [string, string][] = [
  ['D.O.M.', '#ff4fa0'],
  ['Maní', '#4fe3ff'],
  ['Can Roca', '#ffb347'],
  ['Mugaritz', '#ff5a3c'],
  ['Goiânia', '#f6f1e6'],
]

export class NeonSec extends Section {
  mat!: THREE.ShaderMaterial
  quad = new Quad()
  cur = 0
  prev = 0
  onT = 0
  prevOn = 0
  buzz = 0

  async init() {
    await document.fonts.load('italic 400 80px "Instrument Serif"')
    const atlas = wordAtlas(SIGNS.map((s) => s[0]), '"Instrument Serif", serif', 1400, 460, 'italic 400')
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        tSdf: { value: atlas.texture },
        uCount: { value: SIGNS.length },
        uIdx: { value: 0 },
        uPrev: { value: 0 },
        uOn: { value: 0 },
        uPrevOn: { value: 0 },
        uTime: { value: 0 },
        uBuzz: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uMouse: { value: new THREE.Vector2() },
        uCol: { value: new THREE.Vector3(1, 0.3, 0.6) },
        uPrevCol: { value: new THREE.Vector3(1, 0.3, 0.6) },
        uCell: { value: new THREE.Vector4(0.1, 0.4, 0.8, 0.4) },
      },
    })
  }

  col(hex: string) {
    const n = parseInt(hex.slice(1), 16)
    return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uTime.value = c.t
    const asp = rect.w / rect.h
    const cw = Math.min(0.84, 0.84 * asp * 0.8)
    const ch = (cw * asp) / (1400 / 460)
    u.uCell.value.set(0.5 - cw / 2, 0.62 - ch / 2, cw, ch)
    const k = Math.min(SIGNS.length - 1, Math.floor(fit(p, 0.02, 0.95) * SIGNS.length))
    if (k !== this.cur) {
      this.prev = this.cur
      this.prevOn = this.onT > 0.5 ? 1 : this.onT
      this.cur = k
      this.onT = 0
    }
    this.onT += c.dt
    // ligar com tremido: pisca forte nos primeiros 0,7 s e estabiliza
    const t = this.onT
    let on = 1
    if (t < 0.9) {
      const f = Math.sin(t * 60) * Math.sin(t * 23 + 1.3) > (0.6 - t) ? 1 : 0.08
      on = t < 0.12 ? 0 : f
    }
    // chiado perto do cursor
    const m = this.local(c, rect)
    this.buzz += ((m.inside && Math.abs(m.y * 0.5 + 0.5 - 0.62) < 0.15 ? 1 : 0) - this.buzz) * damp(0.1, c.dt)
    if (this.buzz > 0.3 && Math.random() < 0.08 * this.buzz) on *= 0.3
    this.prevOn = Math.max(0, this.prevOn - c.dt * 3)
    u.uIdx.value = this.cur
    u.uPrev.value = this.prev
    u.uOn.value = on
    u.uPrevOn.value = this.prevOn
    u.uCol.value.copy(this.col(SIGNS[this.cur][1]))
    u.uPrevCol.value.copy(this.col(SIGNS[this.prev][1]))
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
