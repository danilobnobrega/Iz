import * as THREE from 'three'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'

// "Cozinha própria": um molho emulsionado sob contraste de fase. Gotas de óleo dançam (movimento
// browniano), e quando duas se tocam elas se fundem numa só, conservando a área. A borda de cada
// gota tem o halo claro típico do microscópio de contraste de fase. O cursor é um batedor: gira o
// líquido em volta dele e quebra as gotas grandes em menores.

const MAXD = 70

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 uRes, uOrigin; uniform float uTime, uOn;
  uniform vec4 uD[${MAXD}];
  varying vec2 vUv;
  float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  void main(){
    vec2 px = gl_FragCoord.xy - uOrigin;
    vec2 uv = px / uRes;
    float asp = uRes.x / uRes.y;
    vec2 p = uv * vec2(asp, 1.0);
    float d = 1e3;
    for (int i = 0; i < ${MAXD}; i++) {
      vec4 g = uD[i];
      if (g.z <= 0.0) continue;
      d = smin(d, length(p - g.xy * vec2(asp, 1.0)) - g.z, 0.012);
    }
    // contraste de fase: fundo cinza médio, gota mais escura com halo claro na borda
    vec3 bg = vec3(0.56, 0.58, 0.55) + (h12(floor(px / 2.0)) - 0.5) * 0.03;
    float inside = 1.0 - smoothstep(-0.0015, 0.0015, d);
    vec3 col = mix(bg, vec3(0.3, 0.32, 0.26), inside);
    col += vec3(0.42) * exp(-max(d, 0.0) * 160.0) * (1.0 - inside);
    col -= vec3(0.15) * exp(-abs(d) * 300.0);
    // brilho interno das gotas (lente)
    col += inside * vec3(0.18, 0.17, 0.1) * smoothstep(-0.02, -0.05, d);
    col = mix(vec3(0.08), col, uOn);
    vec2 c = (uv - 0.5) * vec2(asp, 1.0);
    col *= smoothstep(0.85, 0.6, length(c) / max(1.0, asp * 0.55));
    gl_FragColor = vec4(col, 1.0);
  }`

type D = { x: number; y: number; r: number; vx: number; vy: number }

export class EmulsionSec extends Section {
  mat: THREE.ShaderMaterial
  quad = new Quad()
  ds: D[] = []
  u = Array.from({ length: MAXD }, () => new THREE.Vector4())
  lastM = new THREE.Vector2()

  constructor(el: HTMLElement) {
    super(el)
    for (let i = 0; i < MAXD; i++) this.ds.push({ x: Math.random(), y: Math.random(), r: 0.008 + Math.random() * 0.018, vx: 0, vy: 0 })
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uOrigin: { value: new THREE.Vector2() }, uTime: { value: 0 }, uOn: { value: 0 }, uD: { value: this.u } },
    })
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uTime.value = c.t
    u.uOn.value = ease(fit(p, 0, 0.12)) * (1 - ease(fit(p, 0.92, 1)))
    const asp = rect.w / rect.h
    const m = this.local(c, rect)
    const mx = (m.x + 1) / 2, my = (m.y + 1) / 2
    const mv = new THREE.Vector2(mx - this.lastM.x, my - this.lastM.y)
    this.lastM.set(mx, my)
    const sp = mv.length() / Math.max(c.dt, 1e-3)
    const alive = this.ds.filter((g) => g.r > 0)
    for (const g of alive) {
      // browniano
      g.vx += (Math.random() - 0.5) * 0.0006 / (g.r * 40)
      g.vy += (Math.random() - 0.5) * 0.0006 / (g.r * 40)
      // batedor: redemoinho em volta do cursor
      if (m.inside) {
        const dx = (g.x - mx) * asp, dy = g.y - my
        const dd = Math.hypot(dx, dy) + 1e-4
        const f = Math.exp(-dd * dd / 0.02) * Math.min(3, sp * 0.4 + 0.3)
        g.vx += (-dy / dd) * f * 0.002
        g.vy += (dx / dd) * f * 0.002
        // gotas grandes se quebram quando o batedor passa rápido
        if (f > 1.2 && g.r > 0.022) {
          const child = this.ds.find((o) => o.r <= 0)
          if (child) {
            const nr = g.r / Math.SQRT2
            g.r = nr
            child.r = nr
            child.x = g.x + nr
            child.y = g.y
            child.vx = -g.vx
            child.vy = g.vy
          }
        }
      }
      g.vx *= 0.92
      g.vy *= 0.92
      g.x = (g.x + g.vx + 1) % 1
      g.y = (g.y + g.vy + 1) % 1
    }
    // coalescência: gotas que se tocam viram uma só (área conservada)
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j]
        if (a.r <= 0 || b.r <= 0) continue
        if (Math.hypot((a.x - b.x) * asp, a.y - b.y) < (a.r + b.r) * 0.8) {
          const nr = Math.sqrt(a.r * a.r + b.r * b.r)
          const wa = a.r * a.r / (nr * nr)
          a.x = a.x * wa + b.x * (1 - wa)
          a.y = a.y * wa + b.y * (1 - wa)
          a.r = Math.min(nr, 0.07)
          b.r = 0
        }
      }
    // com o tempo a emulsão se refaz: gotas novas aparecem pequenas
    if (Math.random() < 0.05) {
      const free = this.ds.find((o) => o.r <= 0)
      if (free) Object.assign(free, { x: Math.random(), y: Math.random(), r: 0.008, vx: 0, vy: 0 })
    }
    this.ds.forEach((g, i) => this.u[i].set(g.x, g.y, Math.max(0, g.r), 0))
    void damp
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
