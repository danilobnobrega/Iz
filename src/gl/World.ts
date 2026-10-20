import * as THREE from 'three'
import type { TextBlock } from './Glyphs'

THREE.ColorManagement.enabled = false

// ---------- fotos ----------
// Cada foto viaja entre dois retângulos do DOM (from → to). Cada vértice tem o seu atraso,
// dado pela posição no plano: os cantos chegam em tempos diferentes e a foto curva no voo.
// Aparecer é o mesmo gesto: viajar de um retângulo achatado (a base) até o retângulo inteiro.

const photoVert = /* glsl */ `
  uniform vec4 uFrom;
  uniform vec4 uTo;
  uniform float uP;
  uniform float uLift;
  uniform vec2 uRes;
  uniform float uSkew;
  varying vec2 vUv;
  varying float vShade;
  const float PI = 3.14159265;

  void main() {
    vec2 c = uv; // 0..1, y pra cima
    // peso por vértice: o canto superior direito parte primeiro, o inferior esquerdo por último
    float wgt = 1.0 - (pow(c.x * c.x, 0.75) + pow(1.0 - c.y, 1.5)) * 0.5;
    wgt = mix(wgt, 1.0 - wgt, uSkew);
    float lp = smoothstep(wgt * 0.32, 0.68 + wgt * 0.32, uP);
    vec4 r = mix(uFrom, uTo, lp);
    vec2 px = r.xy + vec2(c.x, 1.0 - c.y) * r.zw;
    float arc = sin(lp * PI);
    // no meio do voo a folha levanta e ganha uma leve rotação
    float z = arc * uLift;
    vShade = 1.0 - arc * 0.12 * step(0.001, uLift);
    vUv = c;
    gl_Position = projectionMatrix * viewMatrix * vec4(px.x - uRes.x * 0.5, uRes.y * 0.5 - px.y, z, 1.0);
  }
`

const photoFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tMap;
  uniform vec2 uCover;
  uniform float uAspect;
  uniform float uZoom;
  uniform float uDim;
  varying vec2 vUv;
  varying float vShade;
  void main() {
    float ra = uCover.x / max(uCover.y, 1.0);
    vec2 s = ra > uAspect ? vec2(1.0, uAspect / ra) : vec2(ra / uAspect, 1.0);
    vec2 uv = (vUv - 0.5) * s / uZoom + 0.5;
    vec3 col = texture2D(tMap, uv).rgb * vShade * uDim;
    gl_FragColor = vec4(col, 1.0);
  }
`

export type Rect = { x: number; y: number; w: number; h: number }
export const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}
export const collapse = (r: Rect): Rect => ({ x: r.x, y: r.y + r.h, w: r.w, h: 0 })

export class Photo {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  from: Rect = { x: 0, y: 0, w: 0, h: 0 }
  to: Rect = { x: 0, y: 0, w: 0, h: 0 }
  p = 0
  lift = 0
  zoom = 1
  dim = 1
  skew = 0

  constructor(tex: THREE.Texture, geo: THREE.PlaneGeometry) {
    const img = tex.image as HTMLImageElement
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: photoVert,
        fragmentShader: photoFrag,
        uniforms: {
          tMap: { value: tex },
          uFrom: { value: new THREE.Vector4() },
          uTo: { value: new THREE.Vector4() },
          uP: { value: 0 },
          uLift: { value: 0 },
          uRes: { value: new THREE.Vector2() },
          uAspect: { value: img.width / img.height },
          uCover: { value: new THREE.Vector2(1, 1) },
          uZoom: { value: 1 },
          uDim: { value: 1 },
          uSkew: { value: 0 },
        },
      }),
    )
    this.mesh.frustumCulled = false
  }

  update(W: number, H: number) {
    const a = this.from
    const b = this.to
    const r = this.p <= 0 ? a : this.p >= 1 ? b : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.w, b.w), h: Math.max(a.h, b.h) }
    const vis = r.y + r.h > -50 && r.y < H + 50 && (this.p > 0.0005 ? true : a.h > 0.5)
    this.mesh.visible = vis
    if (!vis) return
    const u = this.mesh.material.uniforms
    u.uFrom.value.set(a.x, a.y, a.w, a.h)
    u.uTo.value.set(b.x, b.y, b.w, b.h)
    u.uP.value = this.p
    u.uLift.value = this.lift
    u.uRes.value.set(W, H)
    u.uZoom.value = this.zoom
    u.uDim.value = this.dim
    u.uSkew.value = this.skew
    // enquadramento: o tamanho atual (se a origem é uma base achatada, vale o destino)
    const k = a.h < 1 ? 1 : this.p
    u.uCover.value.set(a.w + (b.w - a.w) * k, a.h + (b.h - a.h) * k)
  }
}

// ---------- mundo + acabamento ----------

const fsVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

// rastro do cursor (campo de velocidade que se dissipa)
const trailFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tPrev;
  uniform vec2 uMouse;
  uniform vec2 uVel;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec4 prev = texture2D(tPrev, vUv - texture2D(tPrev, vUv).xy * 0.004);
    vec2 v = prev.xy * 0.955;
    vec2 d = vUv - uMouse;
    d.x *= uAspect;
    float g = exp(-dot(d, d) / 0.004);
    v += uVel * g;
    gl_FragColor = vec4(clamp(v, -1.0, 1.0), 0.0, 1.0);
  }
`

// acabamento único sobre tudo: o rastro do cursor deforma o quadro inteiro,
// lente que curva com a velocidade, aberração nas bordas, gradação, vinheta e grão
const postFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tScene;
  uniform sampler2D tTrail;
  uniform float uVel;
  uniform float uTime;
  uniform vec2 uRes;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    vec2 tr = texture2D(tTrail, uv).xy;
    uv -= tr * 0.018;
    vec2 cc = uv - 0.5;
    float k = clamp(uVel * 0.0022, -0.12, 0.12);
    uv = 0.5 + cc * (1.0 - k * dot(cc, cc) * 2.4);
    float ca = (0.0006 + abs(k) * 0.03 + length(tr) * 0.01) * length(cc) * 2.0;
    vec2 dir = normalize(cc + 1e-5);
    vec3 col;
    col.r = texture2D(tScene, uv + dir * ca).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - dir * ca).b;
    // gradação: curva S leve, sombras quentes
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
    col = mix(col * vec3(1.03, 0.99, 0.94), col, smoothstep(0.0, 0.7, dot(col, vec3(0.333))));
    col *= 1.0 - dot(cc, cc) * 0.32;
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) * 0.038;
    gl_FragColor = vec4(col, 1.0);
  }
`

export class World {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(30, 1, 10, 20000)
  photoGeo = new THREE.PlaneGeometry(1, 1, 36, 36)
  photos: Photo[] = []
  texts: TextBlock[] = []
  W = 1
  H = 1
  vel = 0
  private rt!: THREE.WebGLRenderTarget
  private trailA!: THREE.WebGLRenderTarget
  private trailB!: THREE.WebGLRenderTarget
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private trailScene = new THREE.Scene()
  private postScene = new THREE.Scene()
  private trailMat: THREE.ShaderMaterial
  private postMat: THREE.ShaderMaterial
  private last = new THREE.Vector2(0.5, 0.5)
  private clock = new THREE.Clock()
  private loader = new THREE.TextureLoader()

  constructor(canvas: HTMLCanvasElement, bg: string) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.scene.background = new THREE.Color(bg)
    const quad = new THREE.PlaneGeometry(2, 2)
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: trailFrag,
      uniforms: { tPrev: { value: null }, uMouse: { value: new THREE.Vector2(0.5, 0.5) }, uVel: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
      depthTest: false,
    })
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: postFrag,
      uniforms: { tScene: { value: null }, tTrail: { value: null }, uVel: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() } },
      depthTest: false,
    })
    this.trailScene.add(new THREE.Mesh(quad, this.trailMat))
    this.postScene.add(new THREE.Mesh(quad, this.postMat))
    this.resize()
  }

  async photo(src: string) {
    const tex = await this.loader.loadAsync(src)
    tex.colorSpace = THREE.NoColorSpace
    tex.anisotropy = 8
    const p = new Photo(tex, this.photoGeo)
    this.photos.push(p)
    this.scene.add(p.mesh)
    return p
  }

  addText(t: TextBlock) {
    this.texts.push(t)
    this.scene.add(t.mesh)
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
    this.rt = new THREE.WebGLRenderTarget(this.W * dpr, this.H * dpr, { samples: 4 })
    const o = { type: THREE.HalfFloatType, depthBuffer: false }
    this.trailA?.dispose()
    this.trailB?.dispose()
    this.trailA = new THREE.WebGLRenderTarget(Math.round(this.W / 6), Math.round(this.H / 6), o)
    this.trailB = new THREE.WebGLRenderTarget(Math.round(this.W / 6), Math.round(this.H / 6), o)
    this.trailMat.uniforms.uAspect.value = this.W / this.H
    this.postMat.uniforms.uRes.value.set(this.W, this.H)
  }

  render(mx: number, my: number, scrollVel: number) {
    const t = this.clock.getElapsedTime()
    this.vel += (scrollVel - this.vel) * 0.1
    for (const p of this.photos) p.update(this.W, this.H)
    for (const tb of this.texts) tb.update(this.W, this.H, mx, my)

    const m = new THREE.Vector2(mx / this.W, 1 - my / this.H)
    const v = m.clone().sub(this.last).multiplyScalar(5)
    this.last.copy(m)
    this.trailMat.uniforms.tPrev.value = this.trailA.texture
    this.trailMat.uniforms.uMouse.value.copy(m)
    this.trailMat.uniforms.uVel.value.copy(v)
    this.renderer.setRenderTarget(this.trailB)
    this.renderer.render(this.trailScene, this.fsCam)
    ;[this.trailA, this.trailB] = [this.trailB, this.trailA]

    this.renderer.setRenderTarget(this.rt)
    this.renderer.render(this.scene, this.camera)
    this.postMat.uniforms.tScene.value = this.rt.texture
    this.postMat.uniforms.tTrail.value = this.trailA.texture
    this.postMat.uniforms.uVel.value = this.vel
    this.postMat.uniforms.uTime.value = t
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.postScene, this.fsCam)
  }
}
