import * as THREE from 'three'
import { Section, Quad, FS_VERT, PAPER_V, damp, ease, fit, type Ctx, type Rect } from './core'

// "Origem": a foto dos sócios vira um relevo. O mapa de profundidade dá volume (paralaxe com
// busca em degraus, sem esticar a foto) e normais; o cursor é uma luz que reilumina a cena de
// verdade. A foto aparece por ordem de profundidade: quem está mais perto surge primeiro.

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tImg, tDepth;
  uniform vec2 uSize, uOrigin, uCam, uTexel;
  uniform float uRatio, uReveal, uHide, uZoom, uTime;
  uniform vec3 uLight, uPaper;
  varying vec2 vUv;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  vec2 cover(vec2 uv){
    float br = uSize.x / uSize.y;
    vec2 s = br > uRatio ? vec2(1.0, uRatio / br) : vec2(br / uRatio, 1.0);
    return (uv - 0.5) * s / uZoom + 0.5;
  }
  float dep(vec2 uv){ return texture2D(tDepth, uv).r; }

  void main(){
    vec2 suv = (gl_FragCoord.xy - uOrigin) / uSize;
    vec2 uv = cover(suv);
    // paralaxe em degraus: anda pelo raio até achar a superfície do relevo
    vec2 dir = uCam * 0.045;
    float layers = 24.0;
    float ld = 1.0 / layers;
    float cur = 1.0;
    vec2 tuv = uv - dir * 0.5;
    float d = dep(tuv);
    for (int i = 0; i < 24; i++) {
      if (d >= cur) break;
      cur -= ld;
      tuv += dir * ld;
      d = dep(tuv);
    }
    vec3 col = texture2D(tImg, tuv).rgb;
    // normais a partir do relevo
    float dx = dep(tuv + vec2(uTexel.x, 0.0)) - dep(tuv - vec2(uTexel.x, 0.0));
    float dy = dep(tuv + vec2(0.0, uTexel.y)) - dep(tuv - vec2(0.0, uTexel.y));
    vec3 n = normalize(vec3(-dx * 7.0, -dy * 7.0, 1.0));
    vec3 P = vec3(suv, d * 0.25);
    vec3 L = normalize(uLight - P);
    float lam = max(dot(n, L), 0.0);
    float fall = 1.0 / (1.0 + dot(uLight.xy - suv, uLight.xy - suv) * 2.2);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 40.0) * 0.25;
    col *= 0.62 + (lam * 0.75 + 0.15) * fall * 0.85;
    col += spec * fall;
    // revelar por profundidade: o que está mais perto primeiro, com borda de grão
    float g = h2(floor(gl_FragCoord.xy / 2.0)) * 0.08;
    float show = smoothstep(0.0, 0.04, uReveal * 1.15 - (1.0 - d) - g);
    float hide = smoothstep(0.0, 0.04, uHide * 1.15 - d - g);
    col = mix(uPaper, col, show * (1.0 - hide));
    gl_FragColor = vec4(col, 1.0);
  }`

export class RelightSec extends Section {
  mat: THREE.ShaderMaterial
  quad = new Quad()
  cam = new THREE.Vector2()
  light = new THREE.Vector3(0.5, 0.6, 0.6)

  constructor(el: HTMLElement, private img: string) {
    super(el)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        tImg: { value: null },
        tDepth: { value: null },
        uSize: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uCam: { value: new THREE.Vector2() },
        uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
        uRatio: { value: 1.6 },
        uReveal: { value: 0 },
        uHide: { value: 0 },
        uZoom: { value: 1 },
        uTime: { value: 0 },
        uLight: { value: new THREE.Vector3() },
        uPaper: { value: PAPER_V.clone() },
      },
    })
  }

  async init() {
    const L = new THREE.TextureLoader()
    const base = import.meta.env.BASE_URL
    const [img, dep] = await Promise.all([L.loadAsync(`${base}img/${this.img}.webp`), L.loadAsync(`${base}depth/${this.img}.png`)])
    img.colorSpace = THREE.NoColorSpace
    dep.colorSpace = THREE.NoColorSpace
    const u = this.mat.uniforms
    u.tImg.value = img
    u.tDepth.value = dep
    const im = img.image as HTMLImageElement
    const dm = dep.image as HTMLImageElement
    u.uRatio.value = im.width / im.height
    u.uTexel.value.set(1.5 / dm.width, 1.5 / dm.height)
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const d = c.dpr
    u.uSize.value.set(rect.w * d, rect.h * d)
    u.uOrigin.value.set(rect.x * d, (c.vh - rect.y - rect.h) * d)
    u.uReveal.value = ease(fit(p, 0.0, 0.32))
    u.uHide.value = ease(fit(p, 0.82, 1.0))
    u.uZoom.value = 1.04 + p * 0.1
    const m = this.local(c, rect)
    this.cam.x += ((p - 0.5) * 1.6 + m.x * 0.35 - this.cam.x) * damp(0.08, c.dt)
    this.cam.y += (m.y * 0.25 - this.cam.y) * damp(0.08, c.dt)
    u.uCam.value.copy(this.cam)
    const lx = m.inside ? (m.x + 1) / 2 : 0.7
    const ly = m.inside ? (m.y + 1) / 2 : 0.75
    this.light.x += (lx - this.light.x) * damp(0.1, c.dt)
    this.light.y += (ly - this.light.y) * damp(0.1, c.dt)
    this.light.z = 0.45
    u.uLight.value.copy(this.light)
    u.uTime.value = c.t
  }

  render(c: Ctx, rect: Rect) {
    this.quad.screen(c, rect, this.mat)
  }
}
