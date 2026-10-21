import * as THREE from 'three'
import { wordAtlasExact } from '../gl/wordSdfExact'
import fontUrl from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff?url'
import { Section, Quad, FS_VERT, PAPER_V, INK_V, damp, ease, fit, type Ctx, type Rect } from './core'

// "Paladar": a frase é tinta líquida. As letras são campos de distância exatos; o cursor é uma
// gota da mesma tinta, seguida por gotas menores presas por molas, que se fundem às letras quando
// encostam (união suave) e se soltam com um fio que afina. A rolagem enche as letras da esquerda
// para a direita, como tinta correndo; no fim, a tinta seca e recua.

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSdf;
  uniform float uTexW, uCellH, uCount, uTime, uFill, uDry, uDpr;
  uniform vec2 uOrigin;
  uniform vec4 uLine[2];
  uniform vec3 uDrops[7];
  uniform vec3 uPaper, uInk;
  varying vec2 vUv;

  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

  float cell(vec2 p, vec4 L, float idx){
    vec2 uv = (p - L.xy) / L.zw;
    vec2 q = clamp(uv, vec2(0.002), vec2(0.998));
    vec2 tc = vec2(q.x * uTexW - 0.5, (idx + q.y) * uCellH - 0.5);
    ivec2 i0 = ivec2(floor(tc)); vec2 fr = fract(tc);
    float a = texelFetch(tSdf, i0, 0).r, b = texelFetch(tSdf, i0 + ivec2(1,0), 0).r;
    float c = texelFetch(tSdf, i0 + ivec2(0,1), 0).r, d = texelFetch(tSdf, i0 + ivec2(1,1), 0).r;
    float v = mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y) * L.w;
    return v + length((uv - q) * L.zw);
  }

  void main(){
    vec2 p = gl_FragCoord.xy - uOrigin;
    float d = 1e5;
    for (int i = 0; i < 2; i++) {
      float dl = cell(p, uLine[i], float(i));
      // a tinta corre da esquerda para a direita, com frente arredondada e um pouco irregular
      float front = uLine[i].x + uLine[i].z * (uFill * 1.25 - 0.12 - float(i) * 0.1);
      float wob = (n2(vec2(p.y * 0.02, uTime * 0.3)) - 0.5) * 40.0 * uDpr;
      dl = max(dl, (p.x - front - wob) * 0.6);
      d = min(d, dl);
    }
    // secar: a tinta recua das bordas para dentro, de forma irregular
    d += uDry * (uLine[0].w * 0.09) * (0.6 + 0.8 * n2(p * 0.01));
    // gotas do cursor
    for (int i = 0; i < 7; i++) {
      vec3 g = uDrops[i];
      if (g.z <= 0.0) continue;
      float dg = length(p - g.xy) - g.z;
      d = smin(d, dg, 28.0 * uDpr);
    }
    float aa = fwidth(d) * 0.75;
    float ink = 1.0 - smoothstep(-aa, aa, d);
    // tinta acumula na borda (um pouco mais escura) e o papel tem fibra
    float edge = smoothstep(-6.0 * uDpr, 0.0, d) * ink;
    vec3 inkc = mix(uInk * 1.15, uInk * 0.7, edge);
    float fiber = (n2(p * 0.9) - 0.5) * 0.02 + (n2(p * 0.08) - 0.5) * 0.015;
    vec3 col = mix(uPaper + fiber, inkc + fiber * 0.5, ink);
    col += (h2(p + fract(uTime) * 91.0) - 0.5) * 0.012;
    gl_FragColor = vec4(col, 1.0);
  }`

export class InkSec extends Section {
  mat!: THREE.ShaderMaterial
  quad = new Quad()
  drops = Array.from({ length: 7 }, () => ({ x: -999, y: -999, vx: 0, vy: 0, r: 0 }))

  constructor(el: HTMLElement, private lines: [string, string]) {
    super(el)
  }

  async init(r: THREE.WebGLRenderer) {
    const atlas = await wordAtlasExact(r, this.lines, fontUrl, 1024, 400)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      extensions: { derivatives: true } as any,
      uniforms: {
        tSdf: { value: atlas.texture },
        uTexW: { value: 1024 },
        uCellH: { value: 400 },
        uCount: { value: 2 },
        uTime: { value: 0 },
        uFill: { value: 0 },
        uDry: { value: 0 },
        uDpr: { value: 1 },
        uOrigin: { value: new THREE.Vector2() },
        uLine: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uDrops: { value: Array.from({ length: 7 }, () => new THREE.Vector3()) },
        uPaper: { value: PAPER_V.clone() },
        uInk: { value: INK_V.clone() },
      },
    })
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uDpr.value = d
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uTime.value = c.t
    u.uFill.value = ease(fit(p, 0.0, 0.45))
    u.uDry.value = ease(fit(p, 0.78, 1.0))
    // duas linhas, uma sobre a outra, ocupando a largura útil
    const W = Math.min(rect.w * 0.92, rect.h * 2.2) * d
    const H = W / 2.56
    const x = (rect.w * d - W) / 2
    const top = rect.h * d * 0.5 + H * 0.46
    u.uLine.value[0].set(x - W * 0.04, top - H * 0.62, W, H)
    u.uLine.value[1].set(x + W * 0.04, top - H * 1.3, W, H)
    // gotas: a primeira segue o cursor, as outras seguem a anterior por molas
    const m = this.local(c, rect)
    const tx = ((m.x + 1) / 2) * rect.w * d
    const ty = ((m.y + 1) / 2) * rect.h * d
    this.drops.forEach((g, i) => {
      const ax = i === 0 ? tx : this.drops[i - 1].x
      const ay = i === 0 ? ty : this.drops[i - 1].y
      if (g.x < -900) {
        g.x = ax
        g.y = ay
      }
      const k = i === 0 ? 0.35 : 0.22
      g.vx = g.vx * 0.72 + (ax - g.x) * k
      g.vy = g.vy * 0.72 + (ay - g.y) * k
      g.x += g.vx * damp(1, c.dt)
      g.y += g.vy * damp(1, c.dt)
      const want = m.inside ? (i === 0 ? 26 : 16 - i * 1.8) * d * (c.ptr.down ? 1.5 : 1) : 0
      g.r += (want - g.r) * damp(0.1, c.dt)
      u.uDrops.value[i].set(g.x, g.y, g.r)
    })
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
