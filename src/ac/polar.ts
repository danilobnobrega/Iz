import * as THREE from 'three'
import { wordAtlas } from '../gl/wordSdf'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'

// Abertura: cristais de açúcar crescendo dentro das letras do Íz, vistos entre polarizadores
// cruzados. Cada grão tem uma orientação; a cor vem da física da birrefringência: para cada
// comprimento de onda, intensidade = sen²(2(θ−φ))·sen²(π·Γ/λ), somada no espectro visível (as
// cores de interferência de Michel-Lévy). O cursor gira o polarizador (φ) e todas as cores mudam;
// fora das letras não há cristal e o campo fica escuro, como num microscópio de verdade.

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSdf; uniform vec4 uCell; uniform vec2 uRes, uOrigin;
  uniform float uTime, uGrow, uPhi, uSeedT, uOut;
  uniform vec3 uSeeds[24];
  varying vec2 vUv;
  vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float sdf(vec2 uv){
    vec2 q = (uv - uCell.xy) / uCell.zw;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 1.0;
    return texture2D(tSdf, q).r;
  }
  // espectro aproximado de cada comprimento de onda em RGB
  vec3 wl2rgb(float l){
    vec3 c;
    if (l < 440.0) c = vec3(-(l - 440.0) / 60.0, 0.0, 1.0);
    else if (l < 490.0) c = vec3(0.0, (l - 440.0) / 50.0, 1.0);
    else if (l < 510.0) c = vec3(0.0, 1.0, -(l - 510.0) / 20.0);
    else if (l < 580.0) c = vec3((l - 510.0) / 70.0, 1.0, 0.0);
    else if (l < 645.0) c = vec3(1.0, -(l - 645.0) / 65.0, 0.0);
    else c = vec3(1.0, 0.0, 0.0);
    return clamp(c, 0.0, 1.0);
  }
  vec3 birefringence(float retard, float angle){
    vec3 acc = vec3(0.0); vec3 norm = vec3(0.0);
    float s2 = pow(sin(2.0 * angle), 2.0);
    for (int i = 0; i < 16; i++) {
      float l = 400.0 + float(i) * 20.0;
      vec3 w = wl2rgb(l);
      float I = s2 * pow(sin(3.14159 * retard / l), 2.0);
      acc += w * I; norm += w;
    }
    return acc / norm * 1.6;
  }
  void main(){
    vec2 px = gl_FragCoord.xy - uOrigin;
    vec2 uv = px / uRes;
    float asp = uRes.x / uRes.y;
    // grãos: Voronoi com sementes que nascem em tempos diferentes e crescem
    vec2 g = uv * vec2(asp, 1.0) * 26.0;
    vec2 gi = floor(g), gf = fract(g);
    float best = 9.0; vec2 bid = vec2(0.0); float bt = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(i, j);
      vec2 id = gi + o;
      vec2 r = o + h22(id) - gf;
      float born = h12(id + 3.1) * 0.7;
      float rad = (uGrow - born) * 2.2;
      float d = length(r);
      if (rad > 0.0 && d < rad && d < best) { best = d; bid = id; bt = born; }
    }
    // sementes postas pelo cursor crescem como grãos grandes
    for (int k = 0; k < 24; k++) {
      vec3 s = uSeeds[k];
      if (s.z <= 0.0) continue;
      float d = length((uv - s.xy) * vec2(asp, 1.0)) * 26.0;
      float rad = (uTime - s.z) * 1.4;
      if (d < rad && d < best * 1.6) { best = d * 0.6; bid = vec2(float(k) * 7.3, 91.0); }
    }
    float inside = 1.0 - smoothstep(-0.004, 0.004, sdf(uv));
    float hasGrain = step(best, 8.0) * max(inside, uOut);
    float theta = h12(bid) * 3.14159;
    // espessura varia dentro do grão (degraus de crescimento)
    float retard = 280.0 + h12(bid + 1.7) * 900.0 + (uv.x + uv.y) * 40.0;
    vec3 col = birefringence(retard, theta - uPhi) * hasGrain;
    // contorno dos grãos
    float edge = smoothstep(0.02, 0.0, abs(fract(best * 0.5) - 0.5) - 0.48);
    col *= 0.92;
    // campo escuro com um pouco de luz vazando
    col += vec3(0.012, 0.012, 0.016);
    // vinheta circular da ocular
    vec2 c = (uv - 0.5) * vec2(asp, 1.0);
    col *= smoothstep(0.78, 0.55, length(c) / max(1.0, asp * 0.55));
    col += (h12(gl_FragCoord.xy + fract(uTime) * 11.0) - 0.5) * 0.02;
    gl_FragColor = vec4(col, 1.0);
  }`

export class PolarSec extends Section {
  mat!: THREE.ShaderMaterial
  quad = new Quad()
  phi = 0.3
  seeds = Array.from({ length: 24 }, () => new THREE.Vector3(0, 0, 0))
  seedI = 0
  lastSeed = 0
  t0 = -1

  async init() {
    await document.fonts.load('800 100px "Inter Tight Variable"')
    const atlas = wordAtlas(['Íz'], '"Inter Tight Variable", sans-serif', 1024, 1000, 800)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        tSdf: { value: atlas.texture },
        uCell: { value: new THREE.Vector4(0.2, 0.15, 0.6, 0.7) },
        uRes: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uGrow: { value: 0 },
        uPhi: { value: 0.3 },
        uSeedT: { value: 0 },
        uOut: { value: 0 },
        uSeeds: { value: this.seeds },
      },
    })
  }

  update(p: number, c: Ctx, rect: Rect) {
    if (this.t0 < 0) this.t0 = c.t
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uTime.value = c.t
    // cresce sozinho nos primeiros segundos; a rolagem deixa crescer fora das letras
    u.uGrow.value = Math.min(1, (c.t - this.t0) / 5) * 0.8 + fit(p, 0, 0.5) * 0.4
    u.uOut.value = ease(fit(p, 0.35, 0.8))
    const asp = rect.w / rect.h
    const ch = Math.min(0.86, (0.78 * asp) / (1024 / 1000))
    const cw = (ch * (1024 / 1000)) / asp
    u.uCell.value.set(0.5 - cw / 2, 0.5 - ch / 2, cw, ch)
    const m = this.local(c, rect)
    // o polarizador gira com o cursor (e devagar sozinho)
    const want = m.inside ? m.x * 1.6 : 0.3 + Math.sin(c.t * 0.15) * 0.4
    this.phi += (want - this.phi) * damp(0.05, c.dt)
    u.uPhi.value = this.phi
    // clique planta um cristal novo
    if (c.ptr.down && m.inside && c.t - this.lastSeed > 0.25) {
      this.lastSeed = c.t
      this.seeds[this.seedI].set((m.x + 1) / 2, (m.y + 1) / 2, c.t)
      this.seedI = (this.seedI + 1) % this.seeds.length
    }
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
