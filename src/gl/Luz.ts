import * as THREE from 'three'

// Proposta O. As fotos são "salas" com luz própria:
//  · exposição: começam escuras e acendem (o restaurante abrindo para o jantar)
//  · pontos de luz detectados na própria foto (lâmpadas, velas, janelas) acendem
//    um a um, com halo e um tremor leve
//  · o cursor é uma luz quente que ilumina a foto por onde passa
//  · cada foto viaja entre retângulos do DOM curvando no voo (atraso por vértice)
// Acabamento: bloom nas altas luzes, aberração leve, vinheta e grão.

THREE.ColorManagement.enabled = false

const MAX_SPOTS = 12

export type Rect = { x: number; y: number; w: number; h: number }
export const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

// acha os pontos mais brilhantes da foto (máximos locais de luminância)
export function findSpots(img: HTMLImageElement, max = MAX_SPOTS) {
  const W = 160
  const H = Math.round((W * img.height) / img.width)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const L = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4] / 255
    const g = d[i * 4 + 1] / 255
    const b = d[i * 4 + 2] / 255
    // luz quente pesa mais que céu branco
    L[i] = 0.4 * r + 0.45 * g + 0.15 * b + Math.max(0, r - b) * 0.35
  }
  const cand: { x: number; y: number; v: number }[] = []
  const R = 4
  for (let y = R; y < H - R; y++)
    for (let x = R; x < W - R; x++) {
      const v = L[y * W + x]
      if (v < 0.72) continue
      let peak = true
      for (let j = -R; j <= R && peak; j++) for (let i = -R; i <= R; i++) if (L[(y + j) * W + x + i] > v) peak = false
      if (!peak) continue
      // lâmpada é um ponto pequeno num entorno mais escuro: mede o anel em volta
      let ring = 0
      let n = 0
      for (let a = 0; a < 16; a++) {
        const xx = Math.round(x + Math.cos((a / 16) * Math.PI * 2) * 6)
        const yy = Math.round(y + Math.sin((a / 16) * Math.PI * 2) * 6)
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        ring += L[yy * W + xx]
        n++
      }
      ring /= Math.max(1, n)
      if (v - ring > 0.28) cand.push({ x: x / W, y: 1 - y / H, v: v - ring })
    }
  cand.sort((a, b) => b.v - a.v)
  const out: { x: number; y: number; v: number }[] = []
  for (const c2 of cand) {
    if (out.some((o) => Math.hypot(o.x - c2.x, (o.y - c2.y) * (H / W)) < 0.05)) continue
    out.push(c2)
    if (out.length >= max) break
  }
  // ordem de acender: da esquerda pra direita, como alguém passando pelo salão
  return out.sort((a, b) => a.x - b.x)
}

const vert = /* glsl */ `
  uniform vec4 uFrom;
  uniform vec4 uTo;
  uniform float uP;
  uniform vec2 uRes;
  varying vec2 vUv;
  varying vec2 vScreen;
  const float PI = 3.14159265;
  void main() {
    vec2 c = uv;
    float wgt = 1.0 - (pow(c.x * c.x, 0.75) + pow(1.0 - c.y, 1.5)) * 0.5;
    float lp = smoothstep(wgt * 0.3, 0.7 + wgt * 0.3, uP);
    vec4 r = mix(uFrom, uTo, lp);
    vec2 px = r.xy + vec2(c.x, 1.0 - c.y) * r.zw;
    float z = sin(lp * PI) * 140.0;
    vUv = c;
    vScreen = px;
    gl_Position = projectionMatrix * viewMatrix * vec4(px.x - uRes.x * 0.5, uRes.y * 0.5 - px.y, z, 1.0);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tMap;
  uniform vec2 uCover;
  uniform float uAspect;
  uniform float uZoom;
  uniform float uExposure;
  uniform vec3 uSpots[${MAX_SPOTS}];
  uniform float uSpotOn[${MAX_SPOTS}];
  uniform int uSpotCount;
  uniform vec2 uMouse;
  uniform float uLamp;
  uniform float uLampR;
  uniform float uTime;
  uniform vec4 uRect;
  varying vec2 vUv;
  varying vec2 vScreen;

  vec2 cover(vec2 uv) {
    float ra = uCover.x / max(uCover.y, 1.0);
    vec2 s = ra > uAspect ? vec2(1.0, uAspect / ra) : vec2(ra / uAspect, 1.0);
    return (uv - 0.5) * s / uZoom + 0.5;
  }
  // de coordenada da imagem (0..1) para coordenada do plano
  vec2 imgToPlane(vec2 iuv) {
    float ra = uCover.x / max(uCover.y, 1.0);
    vec2 s = ra > uAspect ? vec2(1.0, uAspect / ra) : vec2(ra / uAspect, 1.0);
    return (iuv - 0.5) * uZoom / s + 0.5;
  }

  void main() {
    vec2 uv = cover(vUv);
    vec3 base = texture2D(tMap, uv).rgb;
    float lum = dot(base, vec3(0.299, 0.587, 0.114));
    // escurecer como uma sala de noite: perde saturação e afunda em azul-escuro
    vec3 night = mix(vec3(lum), base, 0.55) * vec3(0.55, 0.6, 0.78) * 0.22;
    vec3 col = mix(night, base, uExposure);

    float aspect = uCover.x / max(uCover.y, 1.0);
    vec3 warm = vec3(1.0, 0.72, 0.42);

    // pontos de luz da própria foto
    vec3 glow = vec3(0.0);
    for (int i = 0; i < ${MAX_SPOTS}; i++) {
      if (i >= uSpotCount) break;
      vec2 sp = imgToPlane(uSpots[i].xy);
      vec2 d = (vUv - sp) * vec2(aspect, 1.0);
      float on = uSpotOn[i];
      float flick = 0.92 + 0.08 * sin(uTime * (7.0 + float(i)) + float(i) * 3.1) * sin(uTime * 2.3 + float(i));
      float core = exp(-dot(d, d) / 0.00035);
      float halo = exp(-dot(d, d) / 0.012);
      // ilumina a sala em volta da lâmpada
      float spill = exp(-dot(d, d) / 0.06);
      glow += warm * on * flick * (core * 1.4 + halo * 0.22);
      col += base * warm * on * spill * 0.35 * (1.0 - uExposure * 0.85);
    }
    col += glow;

    // o cursor é uma luz quente
    float md = distance(vScreen, uMouse);
    float lamp = exp(-pow(md / uLampR, 2.0)) * uLamp;
    col += base * warm * lamp * (0.9 - uExposure * 0.5);
    col += warm * lamp * smoothstep(0.55, 1.0, lum) * 0.25;

    gl_FragColor = vec4(col, 1.0);
  }
`

export class LitPhoto {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  from: Rect = { x: 0, y: 0, w: 0, h: 0 }
  to: Rect = { x: 0, y: 0, w: 0, h: 0 }
  p = 0
  exposure = 1
  lamp = 1
  zoom = 1
  spots: { x: number; y: number; v: number }[] = []
  spotOn: number[] = []

  constructor(tex: THREE.Texture, geo: THREE.PlaneGeometry, withSpots: boolean) {
    const img = tex.image as HTMLImageElement
    if (withSpots) {
      this.spots = findSpots(img)
      this.spotOn = this.spots.map(() => 0)
    }
    const spots = Array.from({ length: MAX_SPOTS }, (_, i) => new THREE.Vector3(this.spots[i]?.x ?? 0, this.spots[i]?.y ?? 0, 0))
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          tMap: { value: tex },
          uFrom: { value: new THREE.Vector4() },
          uTo: { value: new THREE.Vector4() },
          uP: { value: 0 },
          uRes: { value: new THREE.Vector2() },
          uCover: { value: new THREE.Vector2(1, 1) },
          uAspect: { value: img.width / img.height },
          uZoom: { value: 1 },
          uExposure: { value: 1 },
          uSpots: { value: spots },
          uSpotOn: { value: new Array(MAX_SPOTS).fill(0) },
          uSpotCount: { value: this.spots.length },
          uMouse: { value: new THREE.Vector2(-9999, -9999) },
          uLamp: { value: 1 },
          uLampR: { value: 220 },
          uTime: { value: 0 },
          uRect: { value: new THREE.Vector4() },
        },
      }),
    )
    this.mesh.frustumCulled = false
  }

  update(W: number, H: number, mx: number, my: number, t: number) {
    const a = this.from
    const b = this.to
    const vis = (a.y + a.h > -80 && a.y < H + 80) || (b.y + b.h > -80 && b.y < H + 80)
    this.mesh.visible = vis && (a.h > 0.5 || this.p > 0.001)
    if (!this.mesh.visible) return
    const u = this.mesh.material.uniforms
    u.uFrom.value.set(a.x, a.y, a.w, a.h)
    u.uTo.value.set(b.x, b.y, b.w, b.h)
    u.uP.value = this.p
    u.uRes.value.set(W, H)
    const k = a.h < 1 ? 1 : this.p
    u.uCover.value.set(a.w + (b.w - a.w) * k, a.h + (b.h - a.h) * k)
    u.uZoom.value = this.zoom
    u.uExposure.value = this.exposure
    for (let i = 0; i < this.spotOn.length; i++) u.uSpotOn.value[i] = this.spotOn[i]
    u.uMouse.value.set(mx, my)
    u.uLamp.value = this.lamp
    u.uLampR.value = Math.max(160, Math.min(W, H) * 0.26)
    u.uTime.value = t
  }
}

// ---------- palco + acabamento ----------

const fsVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

const brightFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tIn, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(0.78, 1.25, l), 1.0);
  }
`
const blurFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tIn, vUv).rgb * 0.2270;
    c += texture2D(tIn, vUv + uDir * 1.3846).rgb * 0.3162;
    c += texture2D(tIn, vUv - uDir * 1.3846).rgb * 0.3162;
    c += texture2D(tIn, vUv + uDir * 3.2308).rgb * 0.0702;
    c += texture2D(tIn, vUv - uDir * 3.2308).rgb * 0.0702;
    gl_FragColor = vec4(c, 1.0);
  }
`
const finalFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn; uniform sampler2D tBloom; uniform float uBloom; uniform float uTime; uniform float uVel;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 cc = vUv - 0.5;
    float ca = (0.0008 + min(abs(uVel) * 0.00005, 0.004)) * length(cc) * 2.0;
    vec2 dir = normalize(cc + 1e-5);
    vec3 col = vec3(texture2D(tIn, vUv + dir * ca).r, texture2D(tIn, vUv).g, texture2D(tIn, vUv - dir * ca).b);
    col += texture2D(tBloom, vUv).rgb * uBloom;
    col = col / (1.0 + col * 0.12); // compressão suave das altas luzes
    col *= 1.0 - dot(cc, cc) * 0.42;
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) * 0.035;
    gl_FragColor = vec4(col, 1.0);
  }
`

export class LuzStage {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(30, 1, 10, 20000)
  photos: LitPhoto[] = []
  geo = new THREE.PlaneGeometry(1, 1, 32, 32)
  W = 1
  H = 1
  bloom = 1
  vel = 0
  private rt!: THREE.WebGLRenderTarget
  private bA!: THREE.WebGLRenderTarget
  private bB!: THREE.WebGLRenderTarget
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: THREE.Mesh
  private brightMat: THREE.ShaderMaterial
  private blurMat: THREE.ShaderMaterial
  private finalMat: THREE.ShaderMaterial
  private fsScene = new THREE.Scene()
  private loader = new THREE.TextureLoader()
  private clock = new THREE.Clock()

  constructor(canvas: HTMLCanvasElement, bg: string) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.scene.background = new THREE.Color(bg)
    this.brightMat = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: brightFrag, uniforms: { tIn: { value: null } }, depthTest: false })
    this.blurMat = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: blurFrag, uniforms: { tIn: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false })
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: finalFrag,
      uniforms: { tIn: { value: null }, tBloom: { value: null }, uBloom: { value: 1 }, uTime: { value: 0 }, uVel: { value: 0 } },
      depthTest: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.finalMat)
    this.fsScene.add(this.quad)
    this.resize()
  }

  async photo(src: string, withSpots = false) {
    const t = await this.loader.loadAsync(src)
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 8
    const p = new LitPhoto(t, this.geo, withSpots)
    this.photos.push(p)
    this.scene.add(p.mesh)
    return p
  }

  resize() {
    this.W = window.innerWidth
    this.H = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(this.W, this.H, false)
    const fov = (this.camera.fov * Math.PI) / 180
    this.camera.aspect = this.W / this.H
    this.camera.position.set(0, 0, this.H / 2 / Math.tan(fov / 2))
    this.camera.far = this.camera.position.z * 4
    this.camera.updateProjectionMatrix()
    this.rt?.dispose()
    this.rt = new THREE.WebGLRenderTarget(this.W * dpr, this.H * dpr, { samples: 4, type: THREE.HalfFloatType })
    const bw = Math.round(this.W / 4)
    const bh = Math.round(this.H / 4)
    this.bA?.dispose()
    this.bB?.dispose()
    this.bA = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false })
    this.bB = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false })
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.fsScene, this.fsCam)
  }

  render(mx: number, my: number, scrollVel: number) {
    const t = this.clock.getElapsedTime()
    this.vel += (scrollVel - this.vel) * 0.1
    for (const p of this.photos) p.update(this.W, this.H, mx, my, t)
    this.renderer.setRenderTarget(this.rt)
    this.renderer.render(this.scene, this.camera)

    // bloom: altas luzes, desfocadas em dois eixos, duas vezes
    this.brightMat.uniforms.tIn.value = this.rt.texture
    this.pass(this.brightMat, this.bA)
    for (let i = 0; i < 2; i++) {
      const s = 1 + i * 1.5
      this.blurMat.uniforms.tIn.value = this.bA.texture
      this.blurMat.uniforms.uDir.value.set(s / this.bA.width, 0)
      this.pass(this.blurMat, this.bB)
      this.blurMat.uniforms.tIn.value = this.bB.texture
      this.blurMat.uniforms.uDir.value.set(0, s / this.bA.height)
      this.pass(this.blurMat, this.bA)
    }
    const f = this.finalMat.uniforms
    f.tIn.value = this.rt.texture
    f.tBloom.value = this.bA.texture
    f.uBloom.value = this.bloom
    f.uTime.value = t
    f.uVel.value = this.vel
    this.pass(this.finalMat, null)
  }
}
