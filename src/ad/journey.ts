import * as THREE from 'three'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from '../y/core'

// O site é uma viagem pelas casas de verdade. Cada foto vira um lugar em 3D: o mapa de
// profundidade empurra cada ponto da foto para a sua distância, as quinas entre perto e longe se
// abrem (como num cenário recortado) e a câmera entra no lugar conforme se rola; o cursor mexe a
// cabeça. Na troca de lugar, a cena se desfaz nos seus 64 mil pontos, que voam num redemoinho e
// se montam no lugar seguinte (ou num nome, quando a casa não tem foto).

const GX = 320
const GY = 200
const N = GX * GY

const VERT = /* glsl */ `
  uniform sampler2D tPA, tPB, tCA, tCB, tSeed;
  uniform float uMix, uTime, uPts, uSize, uDpr;
  varying vec3 vCol; varying float vEdge; varying float vA;
  vec3 h33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx) - 0.5; }
  float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(mix(dot(h33(i), f), dot(h33(i+vec3(1,0,0)), f-vec3(1,0,0)), f.x), mix(dot(h33(i+vec3(0,1,0)), f-vec3(0,1,0)), dot(h33(i+vec3(1,1,0)), f-vec3(1,1,0)), f.x), f.y),
               mix(mix(dot(h33(i+vec3(0,0,1)), f-vec3(0,0,1)), dot(h33(i+vec3(1,0,1)), f-vec3(1,0,1)), f.x), mix(dot(h33(i+vec3(0,1,1)), f-vec3(0,1,1)), dot(h33(i+vec3(1,1,1)), f-vec3(1,1,1)), f.x), f.y), f.z); }
  vec3 curl(vec3 p){ float e = 0.1;
    return vec3(n3(p + vec3(0,e,0)) - n3(p - vec3(0,e,0)) - n3(p + vec3(0,0,e)) + n3(p - vec3(0,0,e)),
                n3(p + vec3(0,0,e)) - n3(p - vec3(0,0,e)) - n3(p + vec3(e,0,0)) + n3(p - vec3(e,0,0)),
                n3(p + vec3(e,0,0)) - n3(p - vec3(e,0,0)) - n3(p + vec3(0,e,0)) + n3(p - vec3(0,e,0))) / (2.0 * e); }
  void main(){
    vec4 s = texture2D(tSeed, uv);
    // cada ponto tem a sua hora de partir: da frente para trás, com um pouco de acaso
    float k = clamp(uMix * 1.6 - s.x * 0.6, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    vec4 A = texture2D(tPA, uv), B = texture2D(tPB, uv);
    vec3 p = mix(A.xyz, B.xyz, k);
    // no meio do caminho, o ponto entra num redemoinho e sobe um pouco
    float mid = sin(3.14159 * k);
    p += curl(p * 1.6 + vec3(0.0, uTime * 0.12, s.y * 3.0)) * mid * 0.55;
    p.y += mid * (0.15 + s.z * 0.3);
    p.z += mid * (s.w - 0.3) * 0.8;
    vCol = mix(texture2D(tCA, uv).rgb, texture2D(tCB, uv).rgb, k);
    // quina: onde a profundidade salta, o triângulo some (o lugar fica recortado em camadas)
    vec2 tx = vec2(1.0 / ${GX}.0, 1.0 / ${GY}.0);
    float ea = abs(texture2D(tPA, uv + vec2(tx.x, 0.)).z - A.z) + abs(texture2D(tPA, uv + vec2(0., tx.y)).z - A.z);
    float eb = abs(texture2D(tPB, uv + vec2(tx.x, 0.)).z - B.z) + abs(texture2D(tPB, uv + vec2(0., tx.y)).z - B.z);
    vEdge = mix(ea * A.w, eb * B.w, k) ;
    vA = mix(A.w, B.w, k);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uDpr * (1.0 + mid * 0.8) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`

const FRAG_MESH = /* glsl */ `
  uniform float uPts; varying vec3 vCol; varying float vEdge; varying float vA;
  void main(){
    if (vEdge > 0.045 || uPts > 0.98 || vA < 0.5) discard;
    gl_FragColor = vec4(vCol, 1.0);
  }`
const FRAG_PTS = /* glsl */ `
  uniform float uPts; varying vec3 vCol; varying float vEdge; varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5 || uPts < 0.02) discard;
    gl_FragColor = vec4(vCol * (1.1 - d * 0.6), uPts * smoothstep(0.5, 0.2, d));
  }`

export type Stop = { kind: 'photo'; img: string; depth?: number } | { kind: 'text'; text: string; color: string }

export class JourneySec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(40, 1, 0.01, 50)
  pos: THREE.DataTexture[] = []
  col: THREE.DataTexture[] = []
  mesh!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  pts!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  uniforms: Record<string, THREE.IUniform> = {}
  look = new THREE.Vector2()
  cap: HTMLElement | null
  capI = -1

  constructor(el: HTMLElement, private stops: Stop[], private captionsList: string[]) {
    super(el)
    this.cap = el.querySelector('.ad-place')
    this.scene.background = new THREE.Color('#0d0b0a')
  }

  // tamanho do lugar: cobre a tela a 2,2 de distância
  frame(aspectImg: number) {
    const H = 2 * 2.2 * Math.tan(THREE.MathUtils.degToRad(20)) * 1.12
    const W = H * aspectImg
    return { W, H }
  }

  async photo(name: string, depthScale: number) {
    const base = import.meta.env.BASE_URL
    const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
    const [img, dep] = await Promise.all([load(`${base}img/${name}.webp`), load(`${base}depth/${name}.png`)])
    const sample = (im: HTMLImageElement) => {
      const c = document.createElement('canvas')
      c.width = GX
      c.height = GY
      const x = c.getContext('2d', { willReadFrequently: true })!
      // recorte "cover" para a proporção da grade
      const ga = GX / GY
      const ia = im.width / im.height
      let sw = im.width, sh = im.height, sx = 0, sy = 0
      if (ia > ga) { sw = im.height * ga; sx = (im.width - sw) / 2 } else { sh = im.width / ga; sy = (im.height - sh) / 2 }
      x.drawImage(im, sx, sy, sw, sh, 0, 0, GX, GY)
      return x.getImageData(0, 0, GX, GY).data
    }
    const ci = sample(img)
    const di = sample(dep)
    const { W, H } = this.frame(GX / GY)
    const P = new Float32Array(N * 4)
    const C = new Float32Array(N * 4)
    let dmin = 255, dmax = 0
    for (let i = 0; i < N; i++) { dmin = Math.min(dmin, di[i * 4]); dmax = Math.max(dmax, di[i * 4]) }
    for (let j = 0; j < GY; j++)
      for (let i = 0; i < GX; i++) {
        const k = j * GX + i
        const src = ((GY - 1 - j) * GX + i) * 4
        const d = (di[src] - dmin) / Math.max(1, dmax - dmin)
        // perto (d = 1) vem para a câmera; longe vai para trás, e o tamanho compensa a perspectiva
        const z = (d - 0.5) * depthScale
        const sc = (2.2 - z) / 2.2
        P.set([((i / (GX - 1)) - 0.5) * W * sc, ((j / (GY - 1)) - 0.5) * H * sc, z, 1], k * 4)
        C.set([Math.pow(ci[src] / 255, 1.0), Math.pow(ci[src + 1] / 255, 1.0), Math.pow(ci[src + 2] / 255, 1.0), 1], k * 4)
      }
    return { P, C }
  }

  text(t: string, color: string) {
    const c = document.createElement('canvas')
    c.width = 1600
    c.height = 700
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.fillStyle = '#000'
    x.fillRect(0, 0, 1600, 700)
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    let size = 520
    x.font = `400 ${size}px "Instrument Serif"`
    while (x.measureText(t).width > 1500) { size -= 10; x.font = `400 ${size}px "Instrument Serif"` }
    x.fillText(t, 800, 380)
    const d = x.getImageData(0, 0, 1600, 700).data
    const inside: number[] = []
    for (let i = 0; i < 1600 * 700; i += 3) if (d[i * 4] > 128) inside.push(i)
    const { W } = this.frame(GX / GY)
    const P = new Float32Array(N * 4)
    const C = new Float32Array(N * 4)
    const cc = new THREE.Color(color)
    for (let k = 0; k < N; k++) {
      const i = inside[Math.floor(Math.random() * inside.length)]
      const px = (i % 1600) + Math.random(), py = Math.floor(i / 1600) + Math.random()
      const s = (W * 0.9) / 1600
      const sh = 0.75 + Math.random() * 0.4
      P.set([(px - 800) * s, (350 - py) * s, (Math.random() - 0.5) * 0.08, 0], k * 4)
      C.set([cc.r * sh, cc.g * sh, cc.b * sh, 1], k * 4)
    }
    return { P, C }
  }

  async init() {
    await document.fonts.load('400 80px "Instrument Serif"')
    const datas = await Promise.all(this.stops.map((s) => (s.kind === 'photo' ? this.photo(s.img, s.depth ?? 0.9) : Promise.resolve(this.text(s.text, s.color)))))
    for (const d of datas) {
      const tp = new THREE.DataTexture(d.P, GX, GY, THREE.RGBAFormat, THREE.FloatType)
      tp.needsUpdate = true
      const tc = new THREE.DataTexture(d.C, GX, GY, THREE.RGBAFormat, THREE.FloatType)
      tc.needsUpdate = true
      this.pos.push(tp)
      this.col.push(tc)
    }
    const seed = new Float32Array(N * 4)
    for (let i = 0; i < N; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
    const ts = new THREE.DataTexture(seed, GX, GY, THREE.RGBAFormat, THREE.FloatType)
    ts.needsUpdate = true
    this.uniforms = {
      tPA: { value: this.pos[0] },
      tPB: { value: this.pos[0] },
      tCA: { value: this.col[0] },
      tCB: { value: this.col[0] },
      tSeed: { value: ts },
      uMix: { value: 0 },
      uTime: { value: 0 },
      uPts: { value: 0 },
      uSize: { value: 3 },
      uDpr: { value: 1 },
    }
    const geo = new THREE.PlaneGeometry(1, 1, GX - 1, GY - 1)
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_MESH, uniforms: this.uniforms, side: THREE.DoubleSide }))
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', geo.attributes.position)
    pg.setAttribute('uv', geo.attributes.uv)
    this.pts = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_PTS, uniforms: this.uniforms, transparent: true, depthWrite: false }))
    this.pts.frustumCulled = false
    this.scene.add(this.pts)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 58 : 40
    this.cam.updateProjectionMatrix()
    if (this.uniforms.uDpr) {
      this.uniforms.uDpr.value = dpr
      this.uniforms.uSize.value = (h / 900) * 7.5
    }
  }

  update(p: number, c: Ctx, rect: Rect) {
    if (!this.mesh) return
    const n = this.stops.length
    // cada parada: entra no lugar (60% do trecho), depois a troca (40%)
    const u = fit(p, 0.0, 0.98) * (n - 1)
    const i = Math.min(n - 2, Math.floor(u))
    const f = u - i
    const mix = ease(fit(f, 0.62, 1.0))
    const U = this.uniforms
    U.tPA.value = this.pos[i]
    U.tCA.value = this.col[i]
    U.tPB.value = this.pos[i + 1]
    U.tCB.value = this.col[i + 1]
    U.uMix.value = mix
    U.uTime.value = c.t
    // pontos: sempre nas paradas que são nomes, e no meio de qualquer troca
    const ta = this.stops[i].kind === 'text' ? 1 : 0
    const tb = this.stops[i + 1].kind === 'text' ? 1 : 0
    const pts = Math.max(Math.min(1, Math.sin(Math.PI * mix) * 4), ta + (tb - ta) * mix)
    U.uPts.value = pts
    this.mesh.visible = pts < 0.98
    this.pts.visible = pts > 0.02
    // câmera: avança para dentro do lugar e gira de leve; o cursor é a cabeça
    const m = this.local(c, rect)
    this.look.x += ((m.inside ? m.x : 0) - this.look.x) * damp(0.06, c.dt)
    this.look.y += ((m.inside ? m.y : 0) - this.look.y) * damp(0.06, c.dt)
    const into = ease(fit(f, 0.0, 0.62))
    const isText = this.stops[f > 0.8 ? i + 1 : i].kind === 'text'
    const z = isText ? 2.4 : 2.2 - into * 0.95 + mix * 0.95
    const side = Math.sin(i * 1.7) * 0.25 * into
    this.cam.position.set(this.look.x * 0.22 + side, this.look.y * 0.14, z)
    this.cam.lookAt(this.look.x * 0.05 + side * 0.4, this.look.y * 0.04, 0)
    const show = f > 0.8 ? i + 1 : i
    if (this.cap && this.capI !== show) {
      this.capI = show
      const target = this.cap.querySelector<HTMLElement>('.y-in') ?? this.cap
      target.innerHTML = this.captionsList[show]
    }
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
