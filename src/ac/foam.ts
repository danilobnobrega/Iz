import * as THREE from 'three'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'

// "Padaria própria": a massa fermentando vista de perto. As bolhas são células de Voronoi que
// crescem e se empurram; as paredes são películas finas com cor de interferência (a espessura
// escorre para baixo com a gravidade e oscila com o tempo, como em bolha de sabão). O cursor estoura
// a bolha em que encosta: ela some e as vizinhas ocupam o espaço.

const MAXB = 90

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 uRes, uOrigin; uniform float uTime, uOn;
  uniform vec4 uB[${MAXB}]; // x, y, raio (peso), vida (0 = estourada)
  varying vec2 vUv;
  float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
  vec3 film(float d){ // interferência de película fina (espessura em nm)
    vec3 l = vec3(650.0, 530.0, 450.0);
    return 0.5 + 0.5 * cos(6.2831 * 2.0 * 1.33 * d / l + 3.14159);
  }
  void main(){
    vec2 px = gl_FragCoord.xy - uOrigin;
    vec2 uv = px / uRes;
    float asp = uRes.x / uRes.y;
    vec2 p = uv * vec2(asp, 1.0);
    // diagrama de potência: distância² menos peso (bolhas maiores ocupam mais)
    float d1 = 1e9, d2 = 1e9; int i1 = -1;
    for (int i = 0; i < ${MAXB}; i++) {
      vec4 b = uB[i];
      if (b.w <= 0.0) continue;
      vec2 r = p - b.xy * vec2(asp, 1.0);
      float d = dot(r, r) - b.z * b.z;
      if (d < d1) { d2 = d1; d1 = d; i1 = i; } else if (d < d2) d2 = d;
    }
    // distância aproximada até a parede
    float wall = (d2 - d1) * 12.0;
    float line = smoothstep(0.06, 0.0, wall);
    float thick = 350.0 + 500.0 * n2(p * 3.0 + vec2(0.0, uTime * 0.08)) + (1.0 - uv.y) * 300.0;
    vec3 iri = film(thick);
    // interior da bolha: massa clara e porosa
    vec3 dough = vec3(0.93, 0.86, 0.72) * (0.85 + 0.15 * n2(p * 40.0));
    float shade = smoothstep(0.0, 0.5, wall);
    vec3 col = mix(dough * 0.55, dough, shade);
    // brilho especular no alto de cada bolha
    if (i1 >= 0) {
      vec4 b = uB[i1];
      vec2 r = (p - b.xy * vec2(asp, 1.0)) / max(b.z, 0.01);
      col += vec3(1.0) * smoothstep(0.35, 0.0, length(r - vec2(-0.35, 0.4))) * 0.25;
    }
    col = mix(col, iri * 1.1, line * 0.9);
    col = mix(vec3(0.06, 0.05, 0.04), col, uOn);
    vec2 c = (uv - 0.5) * vec2(asp, 1.0);
    col *= smoothstep(0.85, 0.6, length(c) / max(1.0, asp * 0.55));
    gl_FragColor = vec4(col, 1.0);
  }`

type B = { x: number; y: number; r: number; tr: number; life: number; vx: number; vy: number }

export class FoamSec extends Section {
  mat: THREE.ShaderMaterial
  quad = new Quad()
  bs: B[] = []
  u = Array.from({ length: MAXB }, () => new THREE.Vector4())

  constructor(el: HTMLElement) {
    super(el)
    for (let i = 0; i < MAXB; i++) this.spawn(Math.random(), Math.random())
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uOrigin: { value: new THREE.Vector2() }, uTime: { value: 0 }, uOn: { value: 0 }, uB: { value: this.u } },
    })
  }

  spawn(x: number, y: number, at?: B) {
    const b = at ?? ({} as B)
    b.x = x
    b.y = y
    b.r = 0.005
    b.tr = 0.02 + Math.pow(Math.random(), 2) * 0.09
    b.life = 1
    b.vx = 0
    b.vy = 0
    if (!at) this.bs.push(b)
    return b
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uTime.value = c.t
    u.uOn.value = ease(fit(p, 0, 0.12)) * (1 - ease(fit(p, 0.92, 1)))
    // a massa cresce: as bolhas incham com a rolagem
    const grow = 0.6 + fit(p, 0.0, 0.7) * 0.9
    const m = this.local(c, rect)
    const mx = (m.x + 1) / 2, my = (m.y + 1) / 2
    const asp = rect.w / rect.h
    for (const b of this.bs) {
      if (b.life <= 0) {
        // renasce pequena em algum lugar depois de um tempo
        b.life -= c.dt
        if (b.life < -1.5) this.spawn(Math.random(), Math.random(), b)
        continue
      }
      b.r += (b.tr * grow - b.r) * damp(0.03, c.dt)
      // estoura no cursor
      const dx = (b.x - mx) * asp, dy = b.y - my
      if (m.inside && Math.hypot(dx, dy) < b.r * 0.9) b.life = 0
      // sobe devagar (bolhas leves) e treme
      b.vy += 0.002 * c.dt * (b.r * 10)
      b.vx += (Math.random() - 0.5) * 0.002 * c.dt
      b.vx *= 0.96
      b.vy *= 0.96
      b.x += b.vx
      b.y += b.vy
      if (b.y > 1.15) b.y = -0.15
    }
    this.bs.forEach((b, i) => this.u[i].set(b.x, b.y, b.r, b.life > 0 ? 1 : 0))
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
