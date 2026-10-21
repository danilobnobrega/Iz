import * as THREE from 'three'
import { Section, Quad, FS_VERT, damp, ease, fit, type Ctx, type Rect } from '../y/core'

// "A origem": um quarto escuro com poeira no ar. À esquerda, uma janela com persiana; o sol entra
// em lâminas de luz que atravessam o volume (marcha de raios pelo ar empoeirado, com a sombra da
// persiana calculada em cada ponto) e pousam na parede do fundo, onde está a foto dos sócios.
// Rolando, as lâminas da persiana se abrem e a foto vai sendo iluminada; o cursor move o sol.

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tPhoto; uniform float uRatio, uOpen, uTime, uOn;
  uniform vec2 uRes, uOrigin; uniform vec3 uSun;
  varying vec2 vUv;
  float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
    return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }

  // janela no plano x = -3.2, de z = 0.5 a 3.0, y = -0.6 a 2.0; persiana horizontal
  float window_(vec3 p){
    // projeta o ponto até a janela, seguindo a direção oposta à do sol
    float t = (-3.2 - p.x) / -uSun.x;
    if (t < 0.0) return 0.0;
    vec3 w = p - uSun * t;
    if (w.z < 0.6 || w.z > 3.0 || w.y < -0.8 || w.y > 2.1) return 0.0;
    // lâminas: abrem com uOpen
    float slat = fract(w.y * 6.0);
    float open = mix(0.06, 0.8, uOpen);
    return smoothstep(0.5 - open * 0.5 - 0.02, 0.5 - open * 0.5 + 0.02, slat) * (1.0 - smoothstep(0.5 + open * 0.5 - 0.02, 0.5 + open * 0.5 + 0.02, slat));
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - uOrigin) / uRes;
    vec2 p2 = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec3 ro = vec3(0.0, 0.5, 6.0);
    vec3 rd = normalize(vec3(p2 * 1.1, -1.6));
    // parede do fundo em z = 0
    float tw = (0.0 - ro.z) / rd.z;
    vec3 wp = ro + rd * tw;
    // foto emoldurada na parede
    float fw = 3.4, fh = fw / uRatio;
    vec2 fc = vec2(0.9, 0.45);
    vec2 fq = (wp.xy - fc) / vec2(fw, fh) + 0.5;
    bool inFrame = fq.x > 0.0 && fq.x < 1.0 && fq.y > 0.0 && fq.y < 1.0;
    vec3 wallc = vec3(0.16, 0.13, 0.11) * (0.85 + 0.15 * n3(vec3(wp.xy * 9.0, 0.0)));
    vec3 alb = inFrame ? pow(texture2D(tPhoto, fq).rgb, vec3(2.2)) : wallc;
    float border = inFrame ? 0.0 : (abs(fq.x - 0.5) < 0.53 && abs(fq.y - 0.5) < 0.53 ? 1.0 : 0.0);
    if (border > 0.5) alb = vec3(0.05);
    // luz na parede: sol filtrado pela persiana
    float litW = window_(wp) * uOn;
    vec3 sunc = vec3(1.0, 0.78, 0.5) * 2.6;
    vec3 col = alb * (0.05 + litW * sunc);
    // volume: marcha pelo ar empoeirado até a parede
    float acc = 0.0;
    float steps = 40.0;
    float jitter = h3(vec3(gl_FragCoord.xy, uTime));
    for (int i = 0; i < 40; i++) {
      float t = (float(i) + jitter) / steps * tw;
      vec3 pp = ro + rd * t;
      float dust = 0.55 + 0.45 * n3(pp * 2.2 + vec3(uTime * 0.05, uTime * 0.02, 0.0));
      float mote = smoothstep(0.985, 1.0, n3(pp * 40.0 + vec3(0.0, uTime * 0.15, 0.0)));
      acc += window_(pp) * (dust * 0.035 + mote * 0.4);
    }
    col += vec3(1.0, 0.8, 0.55) * acc * 1.4 * uOn;
    col = col / (1.0 + col);
    col = pow(col, vec3(1.0 / 2.2));
    col += (h3(vec3(gl_FragCoord.xy, fract(uTime))) - 0.5) * 0.02;
    gl_FragColor = vec4(col, 1.0);
  }`

export class BeamsSec extends Section {
  mat: THREE.ShaderMaterial
  quad = new Quad()
  sun = new THREE.Vector3(0.75, -0.35, -0.55).normalize()

  constructor(el: HTMLElement, private img: string) {
    super(el)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        tPhoto: { value: null },
        uRatio: { value: 1.6 },
        uOpen: { value: 0 },
        uTime: { value: 0 },
        uOn: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uSun: { value: this.sun.clone() },
      },
    })
  }

  async init() {
    const t = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}img/${this.img}.webp`)
    t.colorSpace = THREE.NoColorSpace
    const im = t.image as HTMLImageElement
    this.mat.uniforms.tPhoto.value = t
    this.mat.uniforms.uRatio.value = im.width / im.height
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uRes.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uTime.value = c.t
    u.uOn.value = ease(fit(p, 0.0, 0.15)) * (1 - ease(fit(p, 0.9, 1)))
    u.uOpen.value = ease(fit(p, 0.15, 0.7))
    const m = this.local(c, rect)
    const want = new THREE.Vector3(0.75, -0.35 + (m.inside ? m.y * 0.2 : 0), -0.55 + (m.inside ? m.x * 0.25 : 0)).normalize()
    this.sun.lerp(want, damp(0.06, c.dt)).normalize()
    u.uSun.value.copy(this.sun)
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
