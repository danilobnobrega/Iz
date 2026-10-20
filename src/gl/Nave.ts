import * as THREE from 'three'
import { createGlyphSDF, SPREAD, type GlyphSDF } from './sdf'

// Proposta N. Três camadas:
//  1. mundo: um corredor escuro com as fotos das casas como painéis reais, iluminados
//     por uma luz que segue o cursor; neblina e câmera dirigidas pelo scroll; um fio
//     dourado se desenhando pelo caminho
//  2. marca: o Íz como janela (campo de distância), que nasce de um ponto, se preenche
//     de baixo pra cima, pulsa e depois é atravessado
//  3. acabamento: desfoque, aberração, vinheta, curvatura de lente e grão — todos
//     animáveis (entram na abertura, voltam ao abrir o menu)

THREE.ColorManagement.enabled = false

const fsVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

const trailFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tPrev; uniform vec2 uMouse; uniform vec2 uVel; uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec4 prev = texture2D(tPrev, vUv - texture2D(tPrev, vUv).xy * 0.0035);
    vec2 v = prev.xy * 0.955;
    vec2 d = vUv - uMouse; d.x *= uAspect;
    v += uVel * exp(-dot(d, d) / 0.0035);
    gl_FragColor = vec4(clamp(v, -1.0, 1.0), 0.0, 1.0);
  }
`

const markFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tWorld; uniform sampler2D tSdf; uniform sampler2D tTrail;
  uniform vec2 uRes; uniform vec2 uCenter; uniform float uGlyphH; uniform float uAspect; uniform float uSpread;
  uniform float uScale; uniform float uReveal; uniform float uFill; uniform float uDot; uniform float uPulse;
  uniform float uTime; uniform float uDpr; uniform float uBarrel; uniform vec3 uPaper; uniform vec3 uInk;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
  }
  float glyph(vec2 px) {
    float gh = uGlyphH * uScale;
    vec2 g = (px - uCenter) / gh;
    vec2 t = vec2(g.x / uAspect + 0.5, g.y + 0.5);
    float d = (texture2D(tSdf, clamp(t, 0.0, 1.0)).r - 0.5) * 2.0 * uSpread;
    vec2 o = max(abs(t - 0.5) - 0.5, 0.0);
    if (o.x > 0.0 || o.y > 0.0) d = max(d, length(o * vec2(uAspect, 1.0)) + uSpread);
    return d * gh;
  }

  void main() {
    vec2 px = gl_FragCoord.xy / uDpr;
    vec2 tr = texture2D(tTrail, vUv).xy;
    vec2 q = px - tr * 60.0 * (1.0 - smoothstep(4.0, 12.0, uScale));
    float dG = glyph(q);
    float dC = length(q - uCenter) - uDot;
    float d = mix(dC, dG, uReveal);
    // borda viva: um pouco de ruído que cresce enquanto a marca é atravessada
    d += (noise(q * 0.012 + uTime * 0.15) - 0.5) * 6.0 * uReveal * (1.0 + uScale * 0.2);
    float aa = 1.0 + uPulse * 46.0;
    float inside = 1.0 - smoothstep(-aa, aa, d - uPulse * 10.0);

    // o mundo, com lente que curva pela profundidade do mergulho
    vec2 uv = vUv;
    vec2 cc = uv - 0.5;
    uv = 0.5 + cc * (1.0 - uBarrel * dot(cc, cc));
    uv -= tr * 0.012;
    vec3 world = texture2D(tWorld, uv).rgb;

    // preenchimento de baixo pra cima, com borda irregular
    float fy = vUv.y + (noise(vec2(vUv.x * 9.0, uTime * 0.6)) - 0.5) * 0.06;
    float fill = smoothstep(fy - 0.04, fy + 0.04, uFill * 1.12);
    vec3 inner = mix(uInk, world, fill);

    vec3 col = mix(uPaper, inner, inside);
    gl_FragColor = vec4(col, 1.0);
  }
`

const postFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tIn; uniform vec2 uRes; uniform float uBlur; uniform float uCA; uniform float uVignette;
  uniform float uBarrel; uniform float uTime; uniform float uVel;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 sampleCA(vec2 uv, vec2 dir, float ca) {
    return vec3(texture2D(tIn, uv + dir * ca).r, texture2D(tIn, uv).g, texture2D(tIn, uv - dir * ca).b);
  }
  void main() {
    vec2 cc = vUv - 0.5;
    float k = uBarrel + clamp(uVel * 0.0015, -0.08, 0.08);
    vec2 uv = 0.5 + cc * (1.0 + k * dot(cc, cc) * 2.0);
    vec2 dir = normalize(cc + 1e-5);
    float ca = (uCA + abs(uVel) * 0.02) * 0.001 * length(cc) * 2.0;
    vec3 col = sampleCA(uv, dir, ca);
    if (uBlur > 0.05) {
      // desfoque radial: mais forte longe do centro, como uma lente desfocando
      vec3 acc = col; float w = 1.0;
      float r = uBlur * (0.4 + length(cc) * 1.6) / uRes.y;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996;
        float rr = r * sqrt(float(i + 1) / 12.0);
        acc += sampleCA(uv + vec2(cos(a), sin(a)) * rr * vec2(uRes.y / uRes.x, 1.0), dir, ca); w += 1.0;
      }
      col = acc / w;
    }
    col *= 1.0 - dot(cc, cc) * uVignette * 4.0;
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 91.0) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`

export type Panel = { mesh: THREE.Mesh; z: number; house: number }

export class Nave {
  renderer: THREE.WebGLRenderer
  world = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120)
  light = new THREE.PointLight('#ffd9a8', 26, 14, 1.6)
  panels: Panel[] = []
  thread!: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>
  threadCount = 0
  sdf!: GlyphSDF
  // controles
  mark = { reveal: 0, fill: 0, dot: 0, pulse: 0, scale: 1 }
  post = { blur: 22, ca: 3.5, vignette: 0, barrel: 0 }
  travel = 0 // 0..1 ao longo do corredor
  threadDraw = 0
  W = 1
  H = 1
  private dpr = 1
  private rtWorld!: THREE.WebGLRenderTarget
  private rtMark!: THREE.WebGLRenderTarget
  private trailA!: THREE.WebGLRenderTarget
  private trailB!: THREE.WebGLRenderTarget
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private trailMat: THREE.ShaderMaterial
  private markMat: THREE.ShaderMaterial
  private postMat: THREE.ShaderMaterial
  private trailScene = new THREE.Scene()
  private markScene = new THREE.Scene()
  private postScene = new THREE.Scene()
  private last = new THREE.Vector2(0.5, 0.5)
  private clock = new THREE.Clock()
  private loader = new THREE.TextureLoader()
  readonly length = 57 // comprimento do corredor

  constructor(canvas: HTMLCanvasElement, paper: string, ink: string) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const bg = new THREE.Color('#14110e')
    this.world.background = bg
    this.world.fog = new THREE.Fog(bg, 4, 20)
    this.world.add(new THREE.AmbientLight('#fff1dd', 0.5))
    this.world.add(this.light)
    this.world.add(this.camera)

    const quad = new THREE.PlaneGeometry(2, 2)
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: trailFrag,
      uniforms: { tPrev: { value: null }, uMouse: { value: new THREE.Vector2(0.5, 0.5) }, uVel: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
      depthTest: false,
    })
    this.markMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: markFrag,
      uniforms: {
        tWorld: { value: null },
        tSdf: { value: null },
        tTrail: { value: null },
        uRes: { value: new THREE.Vector2() },
        uCenter: { value: new THREE.Vector2() },
        uGlyphH: { value: 400 },
        uAspect: { value: 1 },
        uSpread: { value: SPREAD },
        uScale: { value: 1 },
        uReveal: { value: 0 },
        uFill: { value: 0 },
        uDot: { value: 0 },
        uPulse: { value: 0 },
        uTime: { value: 0 },
        uDpr: { value: 1 },
        uBarrel: { value: 0 },
        uPaper: { value: new THREE.Color(paper) },
        uInk: { value: new THREE.Color(ink) },
      },
      depthTest: false,
    })
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: postFrag,
      uniforms: {
        tIn: { value: null },
        uRes: { value: new THREE.Vector2() },
        uBlur: { value: 0 },
        uCA: { value: 0 },
        uVignette: { value: 0 },
        uBarrel: { value: 0 },
        uTime: { value: 0 },
        uVel: { value: 0 },
      },
      depthTest: false,
    })
    this.trailScene.add(new THREE.Mesh(quad, this.trailMat))
    this.markScene.add(new THREE.Mesh(quad, this.markMat))
    this.postScene.add(new THREE.Mesh(quad, this.postMat))
  }

  async build(houses: string[], extras: string[], onProgress: (p: number) => void) {
    this.sdf = createGlyphSDF('Íz', "'Fraunces Variable'", 900)
    this.markMat.uniforms.tSdf.value = this.sdf.texture
    this.markMat.uniforms.uAspect.value = this.sdf.aspect
    const all = [...houses, ...extras]
    let done = 0
    const tex = await Promise.all(
      all.map(async (src) => {
        const t = await this.loader.loadAsync(src)
        t.colorSpace = THREE.NoColorSpace
        t.anisotropy = 8
        onProgress(++done / all.length)
        return t
      }),
    )
    const geo = new THREE.PlaneGeometry(1, 1, 24, 1)
    // curva leve em cada painel (como uma folha apoiada)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -Math.pow(pos.getX(i) * 2, 2) * 0.06)
    geo.computeVertexNormals()

    const place = (t: THREE.Texture, x: number, y: number, z: number, ry: number, w: number, house: number) => {
      const img = t.image as HTMLImageElement
      const h = w / 1.42
      // enquadramento "cover" pela textura
      const ia = img.width / img.height
      const pa = w / h
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      if (ia > pa) {
        t.repeat.set(pa / ia, 1)
        t.offset.set((1 - pa / ia) / 2, 0)
      } else {
        t.repeat.set(1, ia / pa)
        t.offset.set(0, (1 - ia / pa) / 2)
      }
      const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.48, metalness: 0.0, side: THREE.DoubleSide, transparent: house === 0 })
      const m = new THREE.Mesh(geo, mat)
      m.scale.set(w, h, w)
      m.position.set(x, y, z)
      m.rotation.y = ry
      m.userData.y = y
      this.world.add(m)
      this.panels.push({ mesh: m, z, house })
    }
    // as casas, alternando lados ao longo do corredor
    houses.forEach((_, i) => {
      const side = i % 2 ? 1 : -1
      // a primeira casa fica de frente, preenchendo a janela da marca
      if (i === 0) place(tex[i], 0, 0.1, -2.2, 0, 5.2, i)
      else place(tex[i], side * 2.7, 0.15 + (i % 3) * 0.12, -6 - i * 8.4, -side * 0.5, 3.2, i)
    })
    // fotos de apoio, menores, mais ao fundo das paredes
    extras.forEach((_, j) => {
      const t = tex[houses.length + j]
      const side = j % 2 ? -1 : 1
      place(t, side * (3.6 + (j % 3) * 0.4), 1.4 - (j % 2) * 2.4, -2 - j * 6.1, -side * 0.75, 1.6, -1)
    })

    // fio dourado: um caminho que serpenteia entre as casas, rente ao chão
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 120; i++) {
      const t = i / 120
      const z = 2 - t * (this.length + 4)
      pts.push(new THREE.Vector3(Math.sin(t * Math.PI * 7.0) * 1.1, -1.35 + Math.sin(t * 40) * 0.02, z))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(1400))
    this.thread = new THREE.Line(g, new THREE.LineDashedMaterial({ color: '#d4ad6e', dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9 }))
    this.thread.computeLineDistances()
    this.threadCount = g.attributes.position.count
    this.world.add(this.thread)
    this.resize()
  }

  resize() {
    this.W = window.innerWidth
    this.H = window.innerHeight
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.W, this.H, false)
    this.camera.aspect = this.W / this.H
    this.camera.updateProjectionMatrix()
    const w = Math.round(this.W * this.dpr)
    const h = Math.round(this.H * this.dpr)
    this.rtWorld?.dispose()
    this.rtMark?.dispose()
    this.rtWorld = new THREE.WebGLRenderTarget(w, h, { samples: 4 })
    this.rtMark = new THREE.WebGLRenderTarget(w, h)
    const o = { type: THREE.HalfFloatType, depthBuffer: false }
    this.trailA?.dispose()
    this.trailB?.dispose()
    this.trailA = new THREE.WebGLRenderTarget(Math.round(this.W / 5), Math.round(this.H / 5), o)
    this.trailB = new THREE.WebGLRenderTarget(Math.round(this.W / 5), Math.round(this.H / 5), o)
    this.trailMat.uniforms.uAspect.value = this.W / this.H
    const u = this.markMat.uniforms
    u.uRes.value.set(this.W, this.H)
    u.uDpr.value = this.dpr
    const byH = this.H * 0.8
    const byW = (this.W * 0.9) / (this.sdf ? this.sdf.aspect * 0.86 : 1.2)
    u.uGlyphH.value = Math.min(byH, byW)
    this.postMat.uniforms.uRes.value.set(this.W, this.H)
  }

  render(mx: number, my: number, scrollVel: number) {
    const t = this.clock.getElapsedTime()
    const nx = mx / this.W - 0.5
    const ny = my / this.H - 0.5

    // câmera: percorre o corredor, olhando levemente para o cursor
    const z = 4 - this.travel * this.length
    this.camera.position.set(nx * 0.5 + Math.sin(t * 0.21) * 0.06, -ny * 0.3 + Math.sin(t * 0.17) * 0.04, z)
    this.camera.rotation.set(-ny * 0.08, -nx * 0.14, 0)
    // a luz segue o cursor dentro do mundo, um pouco à frente da câmera
    this.light.position.set(this.camera.position.x + nx * 5.5, this.camera.position.y - ny * 3.2, z - 3.2)
    const fog = this.world.fog as THREE.Fog
    fog.near = 4
    fog.far = 18 + this.travel * 4
    // fio desenhado até a frente da câmera
    this.thread.geometry.setDrawRange(0, Math.floor(this.threadCount * this.threadDraw))
    this.thread.material.dashSize = 0.18
    // painéis respiram levemente
    for (const p of this.panels) {
      p.mesh.position.y = p.mesh.userData.y + Math.sin(t * 0.6 + p.z) * 0.04
      // a foto da abertura se dissolve enquanto a câmera passa por ela
      if (p.house === 0) (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, Math.min(1, (z - p.z - 0.3) / 2.6))
    }

    // rastro do cursor
    const m = new THREE.Vector2(mx / this.W, 1 - my / this.H)
    const v = m.clone().sub(this.last).multiplyScalar(5)
    this.last.copy(m)
    this.trailMat.uniforms.tPrev.value = this.trailA.texture
    this.trailMat.uniforms.uMouse.value.copy(m)
    this.trailMat.uniforms.uVel.value.copy(v)
    this.renderer.setRenderTarget(this.trailB)
    this.renderer.render(this.trailScene, this.fsCam)
    ;[this.trailA, this.trailB] = [this.trailB, this.trailA]

    this.renderer.setRenderTarget(this.rtWorld)
    this.renderer.render(this.world, this.camera)

    // marca: o ponto da haste do Í fica preso enquanto a marca cresce
    const u = this.markMat.uniforms
    const gh = u.uGlyphH.value as number
    const a = this.sdf.anchor
    const cx = this.W / 2
    const cy = this.H / 2 + this.H * 0.02
    const s = this.mark.scale
    const k = Math.min(1, (s - 1) / 6)
    const pin = new THREE.Vector2(cx + a.x * gh, cy + a.y * gh).lerp(new THREE.Vector2(cx, cy), k * k * (3 - 2 * k))
    const center = new THREE.Vector2(pin.x - a.x * gh * s, pin.y - a.y * gh * s).lerp(new THREE.Vector2(cx, cy), 1 - this.mark.reveal)
    u.tWorld.value = this.rtWorld.texture
    u.tTrail.value = this.trailA.texture
    u.uCenter.value.copy(center)
    u.uScale.value = s
    u.uReveal.value = this.mark.reveal
    u.uFill.value = this.mark.fill
    u.uDot.value = this.mark.dot
    u.uPulse.value = this.mark.pulse
    u.uTime.value = t
    u.uBarrel.value = Math.min(0.4, (s - 1) * 0.012)
    this.renderer.setRenderTarget(this.rtMark)
    this.renderer.render(this.markScene, this.fsCam)

    const p = this.postMat.uniforms
    p.tIn.value = this.rtMark.texture
    p.uBlur.value = this.post.blur
    p.uCA.value = this.post.ca
    p.uVignette.value = this.post.vignette
    p.uBarrel.value = this.post.barrel
    p.uTime.value = t
    p.uVel.value += (scrollVel - p.uVel.value) * 0.1
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.postScene, this.fsCam)
  }
}
