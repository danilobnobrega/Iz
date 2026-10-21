import * as THREE from 'three'
import { Bloom } from '../v/post'
import { Quad, FS_VERT, type Ctx, type Rect } from '../y/core'

// Acabamento de cinema para cada cena: renderiza em HDR com antisserrilhado (MSAA), bloom em
// cadeia de mips, e uma finalização com exposição, ACES, um leve grading (sombras frias, altas
// quentes), aberração cromática sutil nas bordas, vinheta e grão.

const FINAL = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn, tBloom;
  uniform float uBloom, uExposure, uTime, uGrain, uFade, uCA;
  uniform vec2 uRes;
  uniform vec3 uShadow, uHigh;
  varying vec2 vUv;
  vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.,1.); }
  vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    // aberração cromática só nas bordas
    vec2 off = c * r2 * uCA;
    vec3 col = vec3(texture2D(tIn, vUv + off).r, texture2D(tIn, vUv).g, texture2D(tIn, vUv - off).b);
    col += texture2D(tBloom, vUv).rgb * uBloom;
    col *= uExposure;
    col = aces(col);
    // grading: puxa as sombras para uma cor e as altas para outra
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * uShadow, (1.0 - smoothstep(0.0, 0.45, l)) * 0.35);
    col = mix(col, col * uHigh, smoothstep(0.5, 1.0, l) * 0.25);
    col = toSRGB(col);
    vec2 cc = c * vec2(uRes.x / uRes.y, 1.0);
    col *= 1.0 - dot(cc, cc) * 0.28;
    col += (h(vUv * uRes + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
    col *= uFade;
    gl_FragColor = vec4(col, 1.0);
  }`

export class FX {
  rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 })
  bloom = new Bloom(6)
  quad = new Quad()
  final = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: FINAL,
    depthTest: false,
    uniforms: {
      tIn: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.6 },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uGrain: { value: 0.03 },
      uFade: { value: 1 },
      uCA: { value: 0.012 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uShadow: { value: new THREE.Vector3(0.85, 0.95, 1.15) },
      uHigh: { value: new THREE.Vector3(1.1, 1.0, 0.88) },
    },
  })
  threshold = 0.9

  resize(w: number, h: number, dpr: number) {
    const W = Math.round(w * dpr), H = Math.round(h * dpr)
    this.rt.setSize(W, H)
    this.bloom.resize(W, H)
    this.final.uniforms.uRes.value.set(W, H)
  }

  render(c: Ctx, rect: Rect, scene: THREE.Scene, cam: THREE.Camera) {
    const r = c.r
    const tm = r.toneMapping
    r.toneMapping = THREE.NoToneMapping
    r.setRenderTarget(this.rt)
    r.clear()
    r.render(scene, cam)
    const bl = this.bloom.run(r, this.rt.texture, this.rt.width, this.rt.height, this.threshold)
    const u = this.final.uniforms
    u.tIn.value = this.rt.texture
    u.tBloom.value = bl
    u.uTime.value = c.t
    this.quad.screen(c, rect, this.final)
    r.toneMapping = tm
  }
}
