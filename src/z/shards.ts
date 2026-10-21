import * as THREE from 'three'
import { Section, Quad, FS_VERT, damp, fit, type Ctx, type Rect } from '../y/core'
import { PAL, raw } from './pal'

// Os pratos em vitral: a foto é cortada em células de Voronoi com "chumbo" entre elas. Para trocar
// de foto, cada célula vira como um ladrilho no próprio eixo (encolhe, escurece no fio, e mostra a
// foto seguinte do outro lado), numa onda que atravessa a tela. Perto do cursor as células se
// inclinam para ele e pegam luz.

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tA, tB;
  uniform vec2 uRes, uOrigin, uMouse;
  uniform float uRA, uRB, uT, uTime, uDensity, uDpr, uHover;
  uniform vec3 uLead, uTint;
  varying vec2 vUv;
  vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  vec2 cover(vec2 uv, float r){ float br = uRes.x / uRes.y; vec2 s = br > r ? vec2(1.0, r / br) : vec2(br / r, 1.0); return (uv - 0.5) * s + 0.5; }
  void main(){
    vec2 px = gl_FragCoord.xy - uOrigin;
    vec2 uv = px / uRes;
    float asp = uRes.x / uRes.y;
    vec2 g = uv * vec2(asp, 1.0) * uDensity;
    vec2 gi = floor(g), gf = fract(g);
    // Voronoi com distância à borda (para o chumbo)
    float md = 8.0; vec2 mr, mc, mo;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(i, j);
      vec2 pt = h22(gi + o);
      pt = 0.5 + 0.38 * sin(uTime * 0.2 + 6.2831 * pt);
      vec2 r = o + pt - gf;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mc = gi + o; mo = pt; }
    }
    float be = 8.0;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec2 o = vec2(i, j);
      vec2 cell = gi + o;
      vec2 pt = 0.5 + 0.38 * sin(uTime * 0.2 + 6.2831 * h22(cell));
      vec2 r = o + pt - gf;
      if (dot(mr - r, mr - r) > 0.00001) be = min(be, dot(0.5 * (mr + r), normalize(r - mr)));
    }
    vec2 center = (mc + mo) / uDensity / vec2(asp, 1.0);
    float rnd = h22(mc + 7.3).x;
    // onda de troca: da esquerda para a direita, com atraso aleatório por célula
    float k = clamp(uT * 1.8 - (center.x * 0.6 + rnd * 0.4) * 0.8, 0.0, 1.0);
    float ang = k * 3.14159;
    float c = cos(ang);
    // a célula vira em torno de um eixo próprio: encolhe na direção do eixo
    vec2 ax = normalize(vec2(cos(rnd * 6.28), sin(rnd * 6.28)));
    vec2 rel = uv - center;
    float along = dot(rel, ax);
    vec2 perp = rel - ax * along;
    float sc = max(abs(c), 0.0001);
    vec2 suv = center + ax * along / sc + perp;
    bool back = c < 0.0;
    bool out_ = abs(along / sc) > 0.6 / uDensity;
    vec3 col;
    if (back) col = texture2D(tB, cover(suv, uRB)).rgb;
    else col = texture2D(tA, cover(suv, uRA)).rgb;
    // escurece no fio e brilha um pouco ao virar
    col *= 0.55 + 0.45 * abs(c);
    col += pow(1.0 - abs(c), 6.0) * 0.25;
    // inclinação para o cursor
    vec2 dm = (center - uMouse) * vec2(asp, 1.0);
    float near = exp(-dot(dm, dm) / 0.03) * uHover;
    col *= 1.0 + near * (0.25 + 0.2 * dot(normalize(rel + 1e-5), -normalize(dm + 1e-5)));
    col = mix(col, col * uTint, 0.12);
    // chumbo entre as células
    float lead = 1.0 - smoothstep(0.02, 0.05, be);
    col = mix(col, uLead, lead);
    if (out_) col = uLead;
    gl_FragColor = vec4(col, 1.0);
  }`

export class ShardsSec extends Section {
  mat: THREE.ShaderMaterial
  quad = new Quad()
  tex: { t: THREE.Texture; r: number }[] = []
  mouse = new THREE.Vector2(-9, -9)

  constructor(el: HTMLElement, private imgs: string[]) {
    super(el)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        tA: { value: null },
        tB: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uMouse: { value: new THREE.Vector2(-9, -9) },
        uRA: { value: 1 },
        uRB: { value: 1 },
        uT: { value: 0 },
        uTime: { value: 0 },
        uDensity: { value: 9 },
        uDpr: { value: 1 },
        uHover: { value: 0 },
        uLead: { value: raw(PAL.ink) },
        uTint: { value: raw(PAL.saffron) },
      },
    })
  }

  async init() {
    const L = new THREE.TextureLoader()
    const base = import.meta.env.BASE_URL
    this.tex = await Promise.all(
      this.imgs.map(async (n) => {
        const t = await L.loadAsync(`${base}img/${n}.webp`)
        t.colorSpace = THREE.NoColorSpace
        const im = t.image as HTMLImageElement
        return { t, r: im.width / im.height }
      }),
    )
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uDpr.value = d
    u.uTime.value = c.t
    u.uDensity.value = rect.w < 760 ? 6 : 9
    // a rolagem passa as fotos; cada troca é uma onda de ladrilhos
    const n = this.tex.length
    const raw_ = fit(p, 0.04, 0.96) * (n - 1)
    const i = Math.min(n - 2, Math.floor(raw_))
    const f = raw_ - i
    u.tA.value = this.tex[i].t
    u.uRA.value = this.tex[i].r
    u.tB.value = this.tex[i + 1].t
    u.uRB.value = this.tex[i + 1].r
    u.uT.value = fit(f, 0.15, 0.85)
    const tints = [PAL.saffron, PAL.pink, PAL.pistachio, PAL.cobalt, PAL.tomato]
    u.uTint.value.lerp(raw(tints[i % tints.length]), damp(0.05, c.dt))
    const m = this.local(c, rect)
    this.mouse.set((m.x + 1) / 2, (m.y + 1) / 2)
    u.uMouse.value.copy(this.mouse)
    u.uHover.value += ((m.inside ? 1 : 0) - u.uHover.value) * damp(0.1, c.dt)
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
