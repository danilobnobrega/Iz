import * as THREE from 'three'

// Pós-processamento comum a todas as cenas: o "corte de vidro" que costura um lugar no outro,
// bloom em cadeia de mips e a finalização (exposição, ACES, grão, vinheta).

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`

export function rt(w: number, h: number, samples = 0) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples,
    depthBuffer: samples > 0,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  })
}

export class Quad {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
  constructor() {
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }
  run(r: THREE.WebGLRenderer, m: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.mesh.material = m
    r.setRenderTarget(target)
    r.render(this.scene, this.cam)
  }
}
export const quad = new Quad()

// ---------- corte de vidro ----------
// Uma barra de vidro grosso atravessa a tela: abaixo dela, o lugar seguinte; dentro dela, os dois
// lugares refratados com dispersão espectral (seis comprimentos de onda). No modo radial, a mesma
// lei vira um anel de vidro que cresce a partir de um ponto (entrar e sair de uma casa).
const CUT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tA, tB;
  uniform float uP, uTime, uVel, uMode, uAspect, uW;
  uniform vec2 uCenter;
  varying vec2 vUv;

  vec3 spectral(float x){ // aproximação de cor por comprimento de onda, x em 0..1 (vermelho → violeta)
    return clamp(vec3(
      1.5 - abs(4.0*x - 1.0) * 1.0,
      1.5 - abs(4.0*x - 2.0) * 1.0,
      1.5 - abs(4.0*x - 3.0) * 1.0), 0.0, 1.0);
  }

  // distância assinada até a borda do corte (negativo = lado B) e direção normal
  float field(vec2 uv, out vec2 n){
    if (uMode < 0.5) {
      float b = mix(-0.25, 1.25, uP) + (uv.x - 0.5) * 0.14 + sin(uv.x * 5.3 + uTime * 0.6) * 0.012;
      n = normalize(vec2(-0.14, 1.0));
      return uv.y - b;
    }
    vec2 d = (uv - uCenter) * vec2(uAspect, 1.0);
    float r = mix(-0.2, 1.9, uP);
    n = normalize(d + 1e-5);
    n.x /= uAspect;
    return length(d) - r;
  }

  vec3 pick(vec2 uv){
    vec2 n; float s = field(uv, n);
    uv = clamp(uv, 0.0005, 0.9995);
    return s < 0.0 ? texture2D(tB, uv).rgb : texture2D(tA, uv).rgb;
  }

  void main(){
    vec2 uv = vUv;
    // pequena lente de barril quando a rolagem acelera
    vec2 c = uv - 0.5;
    uv = 0.5 + c * (1.0 - uVel * 0.035 * dot(c, c) * 4.0);

    vec2 n; float s = field(uv, n);
    float w = uW;
    float d = s / w; // -1..1 dentro da barra
    vec3 col;
    if (abs(d) < 1.0 && uP > 0.0 && uP < 1.0) {
      // perfil de vidro: lente cilíndrica, mais forte perto das bordas
      float prof = d * (1.0 - d * d * 0.35);
      vec2 off = -n * prof * w * (uMode > 0.5 ? 0.45 : 0.4);
      col = vec3(0.0);
      vec3 wsum = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float k = float(i) / 5.0;
        vec3 sc = spectral(k);
        vec2 o = off * (0.94 + k * 0.12);
        col += pick(uv + o) * sc;
        wsum += sc;
      }
      col /= wsum;
      // reflexo nas duas arestas e um leve tom do vidro
      float edge = pow(smoothstep(0.82, 1.0, abs(d)), 3.0);
      col = col * mix(vec3(1.0), vec3(0.95, 0.97, 0.94), 0.6) + edge * 0.06;
      col += smoothstep(0.15, 0.0, abs(d - 0.45)) * 0.012;
    } else {
      col = s < 0.0 ? texture2D(tB, uv).rgb : texture2D(tA, uv).rgb;
    }
    gl_FragColor = vec4(col, 1.0);
  }`

export class Cut {
  mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: CUT_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tA: { value: null },
      tB: { value: null },
      uP: { value: 0 },
      uTime: { value: 0 },
      uVel: { value: 0 },
      uMode: { value: 0 },
      uAspect: { value: 1 },
      uW: { value: 0.16 },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    },
  })
  run(
    r: THREE.WebGLRenderer,
    a: THREE.Texture,
    b: THREE.Texture | null,
    p: number,
    out: THREE.WebGLRenderTarget,
    o: { mode?: number; center?: THREE.Vector2; aspect?: number; vel?: number; t?: number; w?: number } = {},
  ) {
    const u = this.mat.uniforms
    u.tA.value = a
    u.tB.value = b ?? a
    u.uP.value = b ? p : 0
    u.uMode.value = o.mode ?? 0
    if (o.center) u.uCenter.value.copy(o.center)
    u.uAspect.value = o.aspect ?? 1
    u.uVel.value = o.vel ?? 0
    u.uTime.value = o.t ?? 0
    u.uW.value = o.w ?? (u.uMode.value > 0.5 ? 0.07 : 0.11)
    quad.run(r, this.mat, out)
  }
}

// ---------- bloom ----------
const DOWN = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn; uniform vec2 uTexel; uniform float uThreshold; uniform float uFirst;
  varying vec2 vUv;
  vec3 s(vec2 o){ return texture2D(tIn, vUv + o * uTexel).rgb; }
  void main(){
    // filtro de 13 amostras (estilo CoD) para descer sem tremer
    vec3 a = s(vec2(-2.,2.)), b = s(vec2(0.,2.)), c = s(vec2(2.,2.));
    vec3 d = s(vec2(-2.,0.)), e = s(vec2(0.)), f = s(vec2(2.,0.));
    vec3 g = s(vec2(-2.,-2.)), h = s(vec2(0.,-2.)), i = s(vec2(2.,-2.));
    vec3 j = s(vec2(-1.,1.)), k = s(vec2(1.,1.)), l = s(vec2(-1.,-1.)), m = s(vec2(1.,-1.));
    vec3 col = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
    if (uFirst > 0.5) {
      float br = max(col.r, max(col.g, col.b));
      float soft = clamp(br - uThreshold + 0.5, 0.0, 1.0);
      soft = soft * soft * 0.5;
      float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
      col *= contrib;
    }
    gl_FragColor = vec4(col, 1.0);
  }`
const UP = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uRadius;
  varying vec2 vUv;
  void main(){
    vec2 t = uTexel * uRadius;
    vec3 c = texture2D(tIn, vUv + vec2(-t.x, t.y)).rgb + texture2D(tIn, vUv + vec2(0., t.y)).rgb * 2. + texture2D(tIn, vUv + t).rgb
           + texture2D(tIn, vUv + vec2(-t.x, 0.)).rgb * 2. + texture2D(tIn, vUv).rgb * 4. + texture2D(tIn, vUv + vec2(t.x, 0.)).rgb * 2.
           + texture2D(tIn, vUv - t).rgb + texture2D(tIn, vUv + vec2(0., -t.y)).rgb * 2. + texture2D(tIn, vUv + vec2(t.x, -t.y)).rgb;
    gl_FragColor = vec4(c / 16. + texture2D(tPrev, vUv).rgb, 1.0);
  }`

export class Bloom {
  levels: THREE.WebGLRenderTarget[] = []
  ups: THREE.WebGLRenderTarget[] = []
  down = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: DOWN,
    depthTest: false,
    uniforms: { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.85 }, uFirst: { value: 0 } },
  })
  up = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: UP,
    depthTest: false,
    uniforms: { tIn: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
  })
  black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)

  constructor(n = 6) {
    for (let i = 0; i < n; i++) {
      this.levels.push(rt(2, 2))
      this.ups.push(rt(2, 2))
    }
    this.black.needsUpdate = true
  }

  resize(w: number, h: number) {
    this.levels.forEach((l, i) => {
      const s = Math.pow(2, i + 1)
      l.setSize(Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s)))
      this.ups[i].setSize(Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s)))
    })
  }

  run(r: THREE.WebGLRenderer, src: THREE.Texture, srcW: number, srcH: number, threshold: number) {
    const d = this.down.uniforms
    let inTex = src
    let tw = srcW
    let th = srcH
    this.levels.forEach((l, i) => {
      d.tIn.value = inTex
      d.uTexel.value.set(1 / tw, 1 / th)
      d.uFirst.value = i === 0 ? 1 : 0
      d.uThreshold.value = threshold
      quad.run(r, this.down, l)
      inTex = l.texture
      tw = l.width
      th = l.height
    })
    const u = this.up.uniforms
    let prev: THREE.Texture = this.black
    for (let i = this.levels.length - 1; i >= 0; i--) {
      const l = this.levels[i]
      u.tIn.value = l.texture
      u.tPrev.value = prev
      u.uTexel.value.set(1 / l.width, 1 / l.height)
      u.uRadius.value = 1
      quad.run(r, this.up, this.ups[i])
      prev = this.ups[i].texture
    }
    return this.ups[0].texture
  }
}

// ---------- finalização ----------
const FINAL = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn, tBloom;
  uniform float uBloom, uExposure, uTime, uGrain, uFade;
  uniform vec2 uRes;
  varying vec2 vUv;
  vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.,1.); }
  vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec3 col = texture2D(tIn, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
    col *= uExposure;
    vec2 c = vUv - 0.5; c.x *= uRes.x / uRes.y;
    col *= 1.0 - dot(c, c) * 0.32;
    col = toSRGB(aces(col));
    float g = h(vUv * uRes + fract(uTime * 7.13) * 91.0) - 0.5;
    col += g * uGrain;
    col *= uFade;
    gl_FragColor = vec4(col, 1.0);
  }`

export class Final {
  mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FINAL,
    depthTest: false,
    uniforms: {
      tIn: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.6 },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uGrain: { value: 0.028 },
      uFade: { value: 1 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
  })
}
