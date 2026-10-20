import * as THREE from 'three'
import gsap from 'gsap'
import tileVert from './shaders/tile.vert'
import tileFrag from './shaders/tile.frag'
import { pointer } from '../ui/pointer'

THREE.ColorManagement.enabled = false

export type Tile = { src: string; casa: string; n: string; meta: string }

export const TILES: Tile[] = [
  { src: '/img/iz_unnamed.webp', casa: 'Íz', n: '#01', meta: 'Contemporânea · 2015 · Setor Marista' },
  { src: '/img/nip_pizza.webp', casa: 'nip', n: '#07', meta: 'Not in Napoli · 2026 · Rua 1130' },
  { src: '/img/gra2.webp', casa: 'Grá', n: '#03', meta: 'Bistrô francês · 192 m · Órion' },
  { src: '/img/t1929.webp', casa: '1929 Trattoria', n: '#02', meta: 'Italiana · 2017 · Setor Marista' },
  { src: '/img/iz_rest.webp', casa: 'Íz', n: '#01', meta: 'Contemporânea · 2015 · Setor Marista' },
  { src: '/img/nip_fachada.webp', casa: 'nip', n: '#07', meta: 'Not in Napoli · 2026 · Rua 1130' },
  { src: '/img/iz_9.webp', casa: 'Íz Hotel Conceito', n: '#06', meta: 'Restaurant with rooms · 3 suítes' },
  { src: '/img/caviar.webp', casa: 'Fulles Kitchen', n: '#05', meta: 'Cozinha na lenha' },
  { src: '/img/nip_polpetone.webp', casa: 'nip', n: '#07', meta: 'Not in Napoli · 2026 · Rua 1130' },
  { src: '/img/gra1.webp', casa: 'Grá', n: '#03', meta: 'Bistrô francês · 192 m · Órion' },
  { src: '/img/ian_chef.webp', casa: 'Bastidores', n: '—', meta: 'Ian Baiocchi · cozinha' },
  { src: '/img/nip_pistache.webp', casa: 'nip', n: '#07', meta: 'Not in Napoli · 2026 · Rua 1130' },
  { src: '/img/trattoria.webp', casa: '1929 Trattoria', n: '#02', meta: 'Italiana · 2017 · Setor Marista' },
  { src: '/img/socios.webp', casa: 'Ian e Domingos', n: '—', meta: 'Sócios desde 2016' },
  { src: '/img/ian_neo.webp', casa: 'Bastidores', n: '—', meta: 'Ian Baiocchi' },
]

type Cell = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; c: number; r: number; tile: Tile; x: number; y: number; hover: number }

export class Grid {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  cells: Cell[] = []
  hovered: Cell | null = null
  open: Cell | null = null
  zoom = 1 // controlado pelo scroll
  visible = true

  private w = 1
  private h = 1
  private tw = 300
  private th = 380
  private gap = 22
  private cols = 0
  private rows = 0
  private off = new THREE.Vector2()
  private target = new THREE.Vector2()
  private vel = new THREE.Vector2()
  private dragging = false
  private last = new THREE.Vector2()
  private downAt = new THREE.Vector2()
  private textures: THREE.Texture[] = []
  private expand = { v: 0 }
  private openBase = { x: 0, y: 0 }
  onOpen: (tile: Tile | null) => void = () => {}

  constructor(canvas: HTMLCanvasElement, private area: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setClearColor('#ecebe6', 1)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.bind()
  }

  async load(onProgress: (p: number) => void) {
    const loader = new THREE.TextureLoader()
    let done = 0
    this.textures = await Promise.all(
      TILES.map(
        (t) =>
          new Promise<THREE.Texture>((resolve) =>
            loader.load(t.src, (tex) => {
              tex.colorSpace = THREE.NoColorSpace
              tex.anisotropy = 4
              onProgress(++done / TILES.length)
              resolve(tex)
            }),
          ),
      ),
    )
    this.resize()
  }

  private build() {
    for (const c of this.cells) {
      this.scene.remove(c.mesh)
      c.mesh.geometry.dispose()
      c.mesh.material.dispose()
    }
    this.cells = []
    const sx = this.tw + this.gap
    const sy = this.th + this.gap
    this.cols = Math.ceil(this.w / sx) + 2
    this.rows = Math.ceil(this.h / sy) + 2
    // garante que o padrão não se repita visivelmente
    if (this.cols * this.rows < TILES.length) this.cols = Math.ceil(TILES.length / this.rows)
    const geo = new THREE.PlaneGeometry(1, 1, 20, 20)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = (c * 4 + r * 7) % TILES.length
        const tex = this.textures[i]
        const img = tex.image as HTMLImageElement
        const mat = new THREE.ShaderMaterial({
          vertexShader: tileVert,
          fragmentShader: tileFrag,
          transparent: true,
          uniforms: {
            tMap: { value: tex },
            uRes: { value: new THREE.Vector2(this.w, this.h) },
            uBulge: { value: 0 },
            uZoom: { value: 1 },
            uPlaneAspect: { value: this.tw / this.th },
            uImageAspect: { value: img.width / img.height },
            uHover: { value: 0 },
            uAlpha: { value: 1 },
            uGray: { value: 0.85 },
            uVel: { value: new THREE.Vector2() },
            uIn: { value: 0 },
          },
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.scale.set(this.tw, this.th, 1)
        this.scene.add(mesh)
        this.cells.push({ mesh, c, r, tile: TILES[i], x: 0, y: 0, hover: 0 })
      }
    }
  }

  intro() {
    this.cells.forEach((cell) => {
      const d = Math.hypot(cell.c - this.cols / 2, cell.r - this.rows / 2)
      gsap.fromTo(cell.mesh.material.uniforms.uIn, { value: 0 }, { value: 1, duration: 1.3, ease: 'expo.inOut', delay: 0.15 + d * 0.07 })
    })
    this.target.x -= this.tw * 1.4
  }

  resize() {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.setSize(this.w, this.h, false)
    this.camera.left = -this.w / 2
    this.camera.right = this.w / 2
    this.camera.top = this.h / 2
    this.camera.bottom = -this.h / 2
    this.camera.updateProjectionMatrix()
    this.tw = Math.round(Math.max(170, Math.min(340, this.w * 0.2)))
    this.th = Math.round(this.tw * 1.27)
    this.gap = Math.round(this.tw * 0.075)
    if (this.textures.length) {
      const wasIn = this.cells.length ? this.cells[0].mesh.material.uniforms.uIn.value : 0
      this.build()
      this.cells.forEach((c) => (c.mesh.material.uniforms.uIn.value = wasIn))
    }
  }

  private bind() {
    const a = this.area
    a.addEventListener('pointerdown', (e) => {
      if (this.open) return
      this.dragging = true
      this.last.set(e.clientX, e.clientY)
      this.downAt.set(e.clientX, e.clientY)
      a.classList.add('is-dragging')
    })
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      this.target.x += (e.clientX - this.last.x) * 1.6
      this.target.y -= (e.clientY - this.last.y) * 1.6
      this.last.set(e.clientX, e.clientY)
    })
    window.addEventListener('pointerup', (e) => {
      if (!this.dragging) return
      this.dragging = false
      a.classList.remove('is-dragging')
      // clique (sem arrastar) abre a foto
      if (this.downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) < 6 && this.hovered) this.openCell(this.hovered)
    })
  }

  private openCell(cell: Cell) {
    this.open = cell
    this.openBase = { x: cell.x, y: cell.y }
    cell.mesh.renderOrder = 10
    this.onOpen(cell.tile)
    gsap.to(this.expand, { v: 1, duration: 1.1, ease: 'expo.inOut' })
  }

  close() {
    if (!this.open) return
    const cell = this.open
    this.onOpen(null)
    gsap.to(this.expand, {
      v: 0,
      duration: 0.9,
      ease: 'expo.inOut',
      onComplete: () => {
        cell.mesh.renderOrder = 0
        this.open = null
      },
    })
  }

  render(dt: number) {
    if (!this.visible) return
    // deriva lenta + arraste com inércia
    if (!this.dragging && !this.open) this.target.x -= 22 * dt
    const prev = this.off.clone()
    this.off.lerp(this.target, 1 - Math.pow(0.0008, dt))
    const v = this.off.clone().sub(prev).divideScalar(Math.max(dt, 1 / 240) * 1000)
    this.vel.lerp(v, 0.2)
    const speed = Math.min(this.vel.length(), 6)
    const par = pointer.smooth

    const sx = this.tw + this.gap
    const sy = this.th + this.gap
    const W = this.cols * sx
    const H = this.rows * sy
    const e = this.expand.v
    const ee = e * e * (3 - 2 * e)

    let hovered: Cell | null = null
    const mx = pointer.x - this.w / 2
    const my = this.h / 2 - pointer.y

    for (const cell of this.cells) {
      // colunas em velocidades levemente diferentes (paralaxe)
      const k = 1 + ((cell.c % 3) - 1) * 0.12
      let x = cell.c * sx + this.off.x + par.x * -30
      let y = cell.r * sy + this.off.y * k + par.y * -24 + (cell.c % 2) * sy * 0.5
      x = ((((x + sx) % W) + W) % W) - sx - W / 2 + sx / 2
      y = ((((y + sy) % H) + H) % H) - sy - H / 2 + sy / 2
      cell.x = x
      cell.y = y

      const u = cell.mesh.material.uniforms
      if (this.open === cell) {
        // a foto cresce até ocupar a tela
        const bx = this.openBase.x
        const by = this.openBase.y
        cell.mesh.position.set(bx + (0 - bx) * ee, by + (0 - by) * ee, 1)
        cell.mesh.scale.set(this.tw + (this.w - this.tw) * ee, this.th + (this.h - this.th) * ee, 1)
        u.uPlaneAspect.value = cell.mesh.scale.x / cell.mesh.scale.y
        u.uAlpha.value = 1
      } else {
        cell.mesh.position.set(x, y, 0)
        cell.mesh.scale.set(this.tw, this.th, 1)
        u.uPlaneAspect.value = this.tw / this.th
        u.uAlpha.value = 1 - ee
      }

      const inside = !this.open && !this.dragging && Math.abs(mx - x) < this.tw / 2 && Math.abs(my - y) < this.th / 2
      if (inside) hovered = cell
      cell.hover += ((inside || this.open === cell ? 1 : 0) - cell.hover) * (1 - Math.pow(0.0005, dt))
      u.uHover.value = cell.hover
      u.uBulge.value = Math.min(speed * 0.028, 0.14) * (1 - ee)
      u.uVel.value.set(this.vel.x, this.vel.y).multiplyScalar(0.25 * (1 - ee))
      u.uZoom.value = this.zoom
      u.uRes.value.set(this.w, this.h)
    }

    if (hovered !== this.hovered) {
      this.hovered = hovered
      this.area.dataset.cursor = hovered ? hovered.tile.casa : 'Arraste'
      this.area.dispatchEvent(new CustomEvent('tilehover', { detail: hovered?.tile ?? null, bubbles: true }))
    }

    this.renderer.render(this.scene, this.camera)
  }
}
