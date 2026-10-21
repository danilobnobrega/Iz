import * as THREE from 'three'
import type { WordAtlas } from './wordSdf'

// O nome em porcelana, desenhado inteiro por raymarching (nenhuma malha): a forma é um campo de
// distância das letras extrudado com bordas arredondadas, apoiado num fundo infinito de estúdio.
// Luz de área macia que segue o cursor, sombra suave, oclusão de contato, translucidez nas partes
// finas, glaze com reflexo. Entre duas palavras, o campo se mistura e o volume se refaz.

export const PORCELANA_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSdf;
  uniform float uCount, uAspect, uA, uB, uMix, uTime, uH, uDepth, uRound, uTexW, uCellH;
  uniform vec2 uRes;
  uniform vec3 uCamPos, uCamTarget, uLight, uTint;
  uniform float uFov, uRoll;
  uniform vec4 uPress;
  uniform float uFloorY;
  uniform float uDebug;
  uniform vec2 uJitter;
  float uHQ = 0.0;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  // distância 2D até a palavra idx, em unidades do mundo
  float word2d(vec2 p, float idx){
    vec2 uv = vec2(p.x / (uH * uAspect) + 0.5, p.y / uH + 0.5);
    vec2 q = clamp(uv, vec2(0.002), vec2(0.998));
    // filtro bilinear feito à mão (não depende do suporte a filtro de meia precisão)
    vec2 tc = vec2(q.x * uTexW - 0.5, (idx + q.y) * uCellH - 0.5);
    ivec2 i0 = ivec2(floor(tc));
    vec2 fr = fract(tc);
    float s00 = texelFetch(tSdf, i0, 0).r;
    float s10 = texelFetch(tSdf, i0 + ivec2(1, 0), 0).r;
    float s01 = texelFetch(tSdf, i0 + ivec2(0, 1), 0).r;
    float s11 = texelFetch(tSdf, i0 + ivec2(1, 1), 0).r;
    float d = mix(mix(s00, s10, fr.x), mix(s01, s11, fr.x), fr.y) * uH;
    // fora da célula: soma a distância até a célula
    vec2 o = (uv - q) * vec2(uH * uAspect, uH);
    return d + length(o);
  }

  // versão suave (B-spline cúbica, 16 leituras) usada só para as normais: paredes sem estrias
  vec4 bsw(float t){ float t2 = t * t, t3 = t2 * t;
    return vec4((1.0 - 3.0*t + 3.0*t2 - t3), (4.0 - 6.0*t2 + 3.0*t3), (1.0 + 3.0*t + 3.0*t2 - 3.0*t3), t3) / 6.0; }
  float word2dHQ(vec2 p, float idx){
    vec2 uv = vec2(p.x / (uH * uAspect) + 0.5, p.y / uH + 0.5);
    vec2 q = clamp(uv, vec2(0.004), vec2(0.996));
    vec2 tc = vec2(q.x * uTexW - 0.5, (idx + q.y) * uCellH - 0.5);
    ivec2 i0 = ivec2(floor(tc)) - 1;
    vec2 fr = fract(tc);
    vec4 wx = bsw(fr.x), wy = bsw(fr.y);
    float acc = 0.0;
    for (int j = 0; j < 4; j++) {
      float row = 0.0;
      for (int i = 0; i < 4; i++) row += texelFetch(tSdf, i0 + ivec2(i, j), 0).r * wx[i];
      acc += row * wy[j];
    }
    vec2 o = (uv - q) * vec2(uH * uAspect, uH);
    return acc * uH + length(o);
  }

  float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

  float letters(vec3 p, float idx, float sink){
    p.y += sink;
    float d2 = uHQ > 0.5 ? word2dHQ(p.xy, idx) : word2d(p.xy, idx);
    vec2 w = vec2(d2 + uRound, abs(p.z) - uDepth + uRound);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - uRound;
  }

  // a palavra que sai afunda no piso como em líquido; a que entra sobe de dentro dele.
  // o piso e as letras são o mesmo material, unidos por um menisco macio
  vec2 map(vec3 p){
    float sinkA = uMix * uMix * (3.0 - 2.0 * uMix) * (uH + 0.4);
    float m2 = clamp(uMix * 1.25 - 0.25, 0.0, 1.0);
    float sinkB = (1.0 - m2 * m2 * (3.0 - 2.0 * m2)) * (uH + 0.4);
    float dl = letters(p, uA, sinkA);
    if (uMix > 0.0) dl = min(dl, letters(p, uB, sinkB));
    vec3 dp = p - uPress.xyz;
    dl += uPress.w * 0.05 * exp(-dot(dp, dp) / 0.05);
    float fl = p.y - uFloorY;
    // menisco mais largo enquanto as letras atravessam o piso
    float k = 0.06 + 0.16 * sin(3.14159265 * uMix);
    float d = smin(dl, fl, k);
    return vec2(d, dl < fl + 0.02 ? 1.0 : 2.0);
  }

  vec3 normal(vec3 p){
    const vec2 k = vec2(1.0, -1.0);
    const float e = 0.004;
    uHQ = 1.0;
    vec3 n = normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x + k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
    uHQ = 0.0;
    return n;
  }

  float softShadow(vec3 ro, vec3 rd){
    float res = 1.0, t = 0.02, ph = 1e10;
    for (int i = 0; i < 40; i++) {
      float h = map(ro + rd * t).x;
      float y = h * h / (2.0 * ph);
      float d = sqrt(max(h * h - y * y, 0.0));
      res = min(res, 9.0 * d / max(0.0, t - y));
      ph = h;
      t += clamp(h, 0.02, 0.25);
      if (res < 0.002 || t > 6.0) break;
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
  }

  float ao(vec3 p, vec3 n){
    float o = 0.0, s = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.015 + 0.09 * float(i);
      o += (h - map(p + n * h).x) * s;
      s *= 0.72;
    }
    return clamp(1.0 - 2.4 * o, 0.0, 1.0);
  }

  vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

  void main(){
    // deslocamento de subpixel por quadro: o acúmulo vira antisserrilhado
    vec2 frag = ((gl_FragCoord.xy + uJitter) / uRes - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec3 ww = normalize(uCamTarget - uCamPos);
    vec3 up = vec3(sin(uRoll), cos(uRoll), 0.0);
    vec3 uu = normalize(cross(ww, up));
    vec3 vv = cross(uu, ww);
    float fl = 1.0 / tan(radians(uFov) * 0.5);
    vec3 rd = normalize(frag.x * 2.0 * uu + frag.y * 2.0 * vv + fl * ww);
    vec3 ro = uCamPos;

    vec3 bg = vec3(0.86, 0.83, 0.78) * uTint;
    float t = 0.0;
    vec2 hit = vec2(-1.0);
    for (int i = 0; i < 220; i++) {
      vec2 h = map(ro + rd * t);
      if (h.x < 0.0002 * (1.0 + t)) { hit = vec2(t, h.y); break; }
      t += h.x * 0.85;
      if (t > 60.0) break;
    }
    if (hit.x < 0.0 && rd.y < 0.0) {
      float tp = (uFloorY - ro.y) / rd.y;
      if (tp > 0.0 && tp < 60.0) { t = tp; hit = vec2(tp, 2.0); }
    }

    vec3 L = normalize(uLight);
    vec3 col = bg;
    if (hit.x > 0.0) {
      vec3 p = ro + rd * t;
      vec3 n = normal(p);
      vec3 v = -rd;
      float sh = softShadow(p + n * 0.003, L);
      float oc = ao(p, n);
      vec3 hcol = normalize(L + v);
      if (uDebug > 0.5) { gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); return; }
      if (hit.y < 1.5) {
        // porcelana: base quente, glaze levemente irregular
        vec3 gn = normalize(n + (vec3(n3(p * 11.0), n3(p * 11.0 + 9.1), n3(p * 11.0 + 4.7)) - 0.5) * 0.018);
        vec3 alb = vec3(0.93, 0.905, 0.86) * uTint;
        float wrap = clamp((dot(gn, L) + 0.35) / 1.35, 0.0, 1.0);
        // translucidez: quanto mais fino o volume ali, mais luz atravessa
        float thick = clamp(-map(p - n * 0.07).x / 0.07, 0.0, 1.0);
        float trans = pow(clamp(dot(v, -L) + 0.4, 0.0, 1.0), 2.0) * (1.0 - thick);
        float sky = 0.5 + 0.5 * gn.y;
        vec3 diff = alb * (wrap * sh * 1.1 + (0.34 + 0.16 * sky) * oc);
        diff += vec3(1.0, 0.72, 0.5) * trans * 0.28 * alb;
        float ndh = max(dot(gn, hcol), 0.0);
        float spec = pow(ndh, 140.0) * 1.6 + pow(ndh, 18.0) * 0.08;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(gn, v), 0.0), 5.0);
        vec3 refl = mix(bg * 0.9, vec3(1.1, 1.05, 1.0), smoothstep(-0.2, 0.8, reflect(-v, gn).y));
        col = diff * oc + spec * sh + refl * fres * 0.35 * oc;
      } else {
        // fundo de estúdio: mesma cor, sombra e contato
        float wrap = clamp(dot(n, L), 0.0, 1.0);
        vec3 alb = bg;
        col = alb * (0.62 + 0.38 * wrap * sh) * mix(0.78, 1.0, oc);
        col *= 1.0 - (1.0 - sh) * 0.18;
      }
      // o fundo some no horizonte
      col = mix(col, bg, smoothstep(9.0, 30.0, t));
    }
    col = aces(col * 1.05);
    col = pow(col, vec3(1.0 / 2.2));
    col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.018;
    gl_FragColor = vec4(col, 1.0);
  }`

export class Porcelana {
  r: THREE.WebGLRenderer
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  rt: THREE.WebGLRenderTarget
  mat: THREE.ShaderMaterial
  blend: THREE.ShaderMaterial
  copy: THREE.ShaderMaterial
  acc = [0, 1].map(() => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false }))
  accI = 0
  frameN = 0
  alpha = 1
  quad: THREE.Mesh
  scale = 1
  w = 1
  h = 1

  constructor(canvas: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false })
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false })
    this.mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: PORCELANA_FRAG,
      depthTest: false,
      uniforms: {
        tSdf: { value: null },
        uCount: { value: 1 },
        uTexW: { value: 1 },
        uCellH: { value: 1 },
        uAspect: { value: 1 },
        uA: { value: 0 },
        uB: { value: 0 },
        uMix: { value: 0 },
        uTime: { value: 0 },
        uH: { value: 2.4 },
        uDepth: { value: 0.22 },
        uRound: { value: 0.045 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCamPos: { value: new THREE.Vector3(0, 0.2, 6) },
        uCamTarget: { value: new THREE.Vector3(0, 0, 0) },
        uLight: { value: new THREE.Vector3(-0.5, 0.8, 0.6) },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uFov: { value: 30 },
        uRoll: { value: 0 },
        uPress: { value: new THREE.Vector4(0, 0, 0, 0) },
        uFloorY: { value: -1.2 },
        uDebug: { value: 0 },
        uJitter: { value: new THREE.Vector2() },
      },
    })
    // acúmulo: cada quadro novo entra com peso alpha sobre a média dos anteriores
    this.blend = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tCur, tPrev; uniform float uAlpha; varying vec2 vUv;
        void main(){ gl_FragColor = vec4(mix(texture2D(tPrev, vUv).rgb, texture2D(tCur, vUv).rgb, uAlpha), 1.0); }`,
      depthTest: false,
      uniforms: { tCur: { value: null }, tPrev: { value: null }, uAlpha: { value: 1 } },
    })
    this.copy = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }`,
      depthTest: false,
      uniforms: { t: { value: null } },
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
    this.resize()
  }

  setAtlas(atlas: WordAtlas) {
    const u = this.mat.uniforms
    u.tSdf.value = atlas.texture
    u.uCount.value = atlas.count
    u.uTexW.value = atlas.texture.image.width
    u.uCellH.value = atlas.texture.image.height / atlas.count
    u.uAspect.value = atlas.aspect
  }

  get u() {
    return this.mat.uniforms
  }

  resize() {
    this.w = innerWidth
    this.h = innerHeight
    const dpr = Math.min(devicePixelRatio, 1.5)
    this.r.setPixelRatio(dpr)
    this.r.setSize(this.w, this.h, false)
    const W = Math.round(this.w * dpr * this.scale)
    const H = Math.round(this.h * dpr * this.scale)
    this.rt.setSize(W, H)
    this.acc.forEach((a) => a.setSize(W, H))
    this.u.uRes.value.set(W, H)
    this.alpha = 1
  }

  // alpha: 1 = só o quadro novo (movimento rápido); perto de 0 = converge para uma imagem limpa
  render(alpha: number) {
    this.frameN++
    // sequência de Halton (2,3) para o deslocamento de subpixel
    const halton = (i: number, b: number) => {
      let f = 1, r = 0
      while (i > 0) {
        f /= b
        r += f * (i % b)
        i = Math.floor(i / b)
      }
      return r
    }
    const k = (this.frameN % 16) + 1
    this.u.uJitter.value.set(halton(k, 2) - 0.5, halton(k, 3) - 0.5)
    this.quad.material = this.mat
    this.r.setRenderTarget(this.rt)
    this.r.render(this.scene, this.cam)
    const prev = this.acc[this.accI]
    const next = this.acc[1 - this.accI]
    this.blend.uniforms.tCur.value = this.rt.texture
    this.blend.uniforms.tPrev.value = prev.texture
    this.blend.uniforms.uAlpha.value = Math.max(alpha, this.alpha)
    this.alpha = 0
    this.quad.material = this.blend
    this.r.setRenderTarget(next)
    this.r.render(this.scene, this.cam)
    this.accI = 1 - this.accI
    this.quad.material = this.copy
    this.copy.uniforms.t.value = next.texture
    this.r.setRenderTarget(null)
    this.r.render(this.scene, this.cam)
  }
}
