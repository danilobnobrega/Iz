import * as THREE from 'three'
import fullscreenVert from './shaders/fullscreen.vert'
import trailFrag from './shaders/trail.frag'
import panelVert from './shaders/panel.vert'
import panelFrag from './shaders/panel.frag'
import heroFrag from './shaders/hero.frag'
import { createGlyphSDF, SPREAD, type GlyphSDF } from './sdf'
import { pointer } from '../ui/pointer'

// o pipeline inteiro trabalha em sRGB: cores e texturas entram e saem sem conversão
THREE.ColorManagement.enabled = false

const PAPER = new THREE.Color('#ecebe6')
const INK = new THREE.Color('#111110')
const WORLD_BG = new THREE.Color('#0d0d0c')

// imagens dentro da janela (placeholders da imprensa), em três anéis que cobrem a volta toda
const IMAGES = [
  '/img/iz_unnamed.webp',
  '/img/nip_pizza.webp',
  '/img/gra2.webp',
  '/img/nip_fachada.webp',
  '/img/t1929.webp',
  '/img/caviar.webp',
  '/img/nip_polpetone.webp',
  '/img/iz_9.webp',
  '/img/socios.webp',
  '/img/nip_pistache.webp',
  '/img/gra1.webp',
  '/img/iz_rest.webp',
  '/img/ian_chef.webp',
  '/img/trattoria.webp',
  '/img/ian_neo.webp',
]
const RADIUS = 6
const COLS = 13
const ROWS = [
  { y: 1.95, speed: 0.03, offset: 0.0 },
  { y: 0.0, speed: -0.022, offset: 0.24 },
  { y: -1.95, speed: 0.026, offset: 0.11 },
]
const PANEL_GAP = 0.06 // radianos entre painéis

export type HeroState = {
  reveal: number // 0 = ponto, 1 = marca
  fill: number // 0 = marca sólida, 1 = janela aberta
  dot: number // raio do ponto em px
  scroll: number // 0..1 progresso do hero
  visible: boolean
}

export class Stage {
  renderer: THREE.WebGLRenderer
  hero: HeroState = { reveal: 0, fill: 0, dot: 0, scroll: 0, visible: true }
  private dpr = 1
  private w = 1
  private h = 1
  private clock = new THREE.Clock()
  private fsGeo = new THREE.PlaneGeometry(2, 2)
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // rastro do cursor
  private trailA!: THREE.WebGLRenderTarget
  private trailB!: THREE.WebGLRenderTarget
  private trailMat: THREE.ShaderMaterial
  private trailScene = new THREE.Scene()
  private lastMouse = new THREE.Vector2(0.5, 0.5)

  // mundo dentro da janela
  private world = new THREE.Scene()
  private worldCam = new THREE.PerspectiveCamera(46, 1, 0.1, 60)
  private worldRT!: THREE.WebGLRenderTarget
  private panels: THREE.Mesh[] = []
  private rig = new THREE.Group()

  // composição
  private heroMat: THREE.ShaderMaterial
  private heroScene = new THREE.Scene()
  sdf!: GlyphSDF

  private loader = new THREE.TextureLoader()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setClearColor(PAPER, 1)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace

    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: trailFrag,
      uniforms: {
        tPrev: { value: null },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uVel: { value: new THREE.Vector2() },
        uAspect: { value: 1 },
        uDecay: { value: 0.955 },
        uRadius: { value: 0.0035 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.trailScene.add(new THREE.Mesh(this.fsGeo, this.trailMat))

    this.world.background = WORLD_BG
    this.world.add(this.rig)
    this.rig.add(this.worldCam)

    this.heroMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: heroFrag,
      uniforms: {
        tContent: { value: null },
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
        uSoft: { value: 60 },
        uWobble: { value: 6 },
        uTime: { value: 0 },
        uDpr: { value: 1 },
        uPaper: { value: PAPER.clone() },
        uInk: { value: INK.clone() },
        uDebug: { value: ({ world: 1, sdf: 2, raw: 3 } as Record<string, number>)[new URLSearchParams(location.search).get('debug') || ''] || 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.heroScene.add(new THREE.Mesh(this.fsGeo, this.heroMat))
    this.resize()
  }

  // carrega fontes já resolvidas e texturas; onProgress 0..1
  async load(onProgress: (p: number) => void) {
    this.sdf = createGlyphSDF('Íz', "'Fraunces Variable'", 900)
    this.heroMat.uniforms.tSdf.value = this.sdf.texture
    this.heroMat.uniforms.uAspect.value = this.sdf.aspect

    let done = 0
    const textures = await Promise.all(
      IMAGES.map(
        (src) =>
          new Promise<THREE.Texture | null>((resolve) => {
            this.loader.load(
              src,
              (tex) => {
                tex.colorSpace = THREE.NoColorSpace // tudo trabalha em sRGB, sem conversão
                tex.anisotropy = 4
                onProgress(++done / IMAGES.length)
                resolve(tex)
              },
              undefined,
              () => {
                onProgress(++done / IMAGES.length)
                resolve(null)
              },
            )
          }),
      ),
    )
    const ok = textures.filter((t): t is THREE.Texture => !!t)
    let k = 0
    ROWS.forEach((row, r) => {
      for (let c = 0; c < COLS; c++) {
        const a = row.offset + (c / COLS) * Math.PI * 2
        this.addPanel(ok[(k++ * 7 + r * 3) % ok.length], a, row.y, r)
      }
    })
    this.resize()
    this.renderer.compile(this.world, this.worldCam)
    this.renderer.compile(this.heroScene, this.fsCam)
  }

  private addPanel(tex: THREE.Texture, a0: number, y: number, row: number) {
    const img = tex.image as HTMLImageElement
    const imageAspect = img.width / img.height
    const w = RADIUS * ((Math.PI * 2) / COLS - PANEL_GAP)
    const h = 1.8
    const geo = new THREE.PlaneGeometry(1, h, 48, 1)
    const mat = new THREE.ShaderMaterial({
      vertexShader: panelVert,
      fragmentShader: panelFrag,
      uniforms: {
        tMap: { value: tex },
        uA0: { value: a0 },
        uR: { value: RADIUS },
        uY: { value: y },
        uW: { value: w },
        uBend: { value: 1 },
        uPlaneAspect: { value: w / h },
        uImageAspect: { value: imageAspect },
        uDim: { value: 0.94 },
        uBg: { value: WORLD_BG.clone() },
      },
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.userData = { a: a0, y, row }
    this.panels.push(mesh)
    this.world.add(mesh)
  }

  resize() {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.w, this.h, false)

    const tw = Math.round((this.w * this.dpr) / 4)
    const th = Math.round((this.h * this.dpr) / 4)
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
    this.trailA?.dispose()
    this.trailB?.dispose()
    this.trailA = new THREE.WebGLRenderTarget(tw, th, opts)
    this.trailB = new THREE.WebGLRenderTarget(tw, th, opts)
    this.trailMat.uniforms.uAspect.value = this.w / this.h

    this.worldRT?.dispose()
    this.worldRT = new THREE.WebGLRenderTarget(Math.round(this.w * this.dpr), Math.round(this.h * this.dpr), { samples: 4 })
    this.worldCam.aspect = this.w / this.h
    this.worldCam.updateProjectionMatrix()

    const u = this.heroMat.uniforms
    u.uRes.value.set(this.w, this.h)
    u.uDpr.value = this.dpr
    // a marca ocupa ~46% da altura (ou cabe na largura no celular)
    const byH = this.h * 0.84
    const byW = (this.w * 0.92) / (this.sdf ? this.sdf.aspect * 0.86 : 1.2)
    u.uGlyphH.value = Math.min(byH, byW)
  }

  private stepTrail() {
    const m = pointer.uv
    const vel = new THREE.Vector2(m.x - this.lastMouse.x, m.y - this.lastMouse.y)
    this.lastMouse.copy(m)
    this.trailMat.uniforms.tPrev.value = this.trailA.texture
    this.trailMat.uniforms.uMouse.value.copy(m)
    this.trailMat.uniforms.uVel.value.copy(vel.multiplyScalar(6))
    this.renderer.setRenderTarget(this.trailB)
    this.renderer.render(this.trailScene, this.fsCam)
    ;[this.trailA, this.trailB] = [this.trailB, this.trailA]
  }

  render() {
    const t = this.clock.getElapsedTime()
    this.stepTrail()

    const s = this.hero
    if (!s.visible) {
      this.renderer.setRenderTarget(null)
      this.renderer.clear()
      return
    }

    // mundo: anel de imagens girando devagar, câmera reage ao cursor e avança com o scroll
    const p = s.scroll
    const mx = pointer.smooth.x
    const my = pointer.smooth.y
    this.rig.rotation.y = mx * 0.16
    this.worldCam.rotation.x = my * 0.08
    this.worldCam.position.z = -p * 2.2
    this.worldCam.fov = 46 + p * 18
    this.worldCam.updateProjectionMatrix()
    for (const mesh of this.panels) {
      const mat = mesh.material as THREE.ShaderMaterial
      const row = ROWS[mesh.userData.row]
      mat.uniforms.uA0.value = mesh.userData.a + t * row.speed + p * row.speed * 40
    }
    this.renderer.setRenderTarget(this.worldRT)
    this.renderer.render(this.world, this.worldCam)

    // composição
    const u = this.heroMat.uniforms
    const ease = p * p * p
    const scale = 1 + ease * 46
    const gh = u.uGlyphH.value as number
    // o ponto da haste do Í fica preso na tela enquanto a marca cresce, migrando pro centro
    const screenCenter = new THREE.Vector2(this.w / 2, this.h / 2 + this.h * 0.03)
    const a = this.sdf ? this.sdf.anchor : new THREE.Vector2()
    const start = new THREE.Vector2(screenCenter.x + a.x * gh, screenCenter.y + a.y * gh)
    const k = Math.min(1, p * 1.6)
    const pin = start.clone().lerp(screenCenter, k * k * (3 - 2 * k))
    const center = new THREE.Vector2(pin.x - a.x * gh * scale, pin.y - a.y * gh * scale)
    // durante o carregamento o ponto mora no centro da tela
    center.lerp(screenCenter, 1 - s.reveal)

    u.tContent.value = this.worldRT.texture
    u.tTrail.value = this.trailA.texture
    u.uCenter.value.copy(center)
    u.uScale.value = scale
    u.uReveal.value = s.reveal
    u.uFill.value = s.fill
    u.uDot.value = s.dot
    u.uSoft.value = 46 + ease * 700
    u.uWobble.value = 3.5 + ease * 120
    u.uTime.value = t

    this.renderer.setRenderTarget(null)
    this.renderer.render(this.heroScene, this.fsCam)
  }
}
