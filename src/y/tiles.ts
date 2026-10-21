import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Section, ease, fit, toScreen, type Ctx, type Rect } from './core'

// "Por trás": 445 pecinhas de porcelana, uma por pessoa do grupo. Elas caem sobre a mesa e formam
// o número; depois deslizam, cada uma num pequeno salto, para formar "50 mil" (clientes por mês);
// no fim se alinham numa grade. O cursor é como uma mão na mesa: as peças por perto pulam.

const N = 445

function layout(text: string, n: number, width: number) {
  const W = 1200
  const H = 420
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.fillStyle = '#000'
  x.fillRect(0, 0, W, H)
  x.fillStyle = '#fff'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  let size = 400
  x.font = `${size}px "Instrument Serif"`
  while (x.measureText(text).width > W * 0.94) {
    size -= 6
    x.font = `${size}px "Instrument Serif"`
  }
  x.fillText(text, W / 2, H / 2 + size * 0.05)
  const d = x.getImageData(0, 0, W, H).data
  const at = (px: number, py: number) => d[(Math.floor(py) * W + Math.floor(px)) * 4] > 128
  // procura o espaçamento de grade que dá exatamente n pontos dentro das letras
  let lo = 2, hi = 80, pts: [number, number][] = []
  for (let it = 0; it < 30; it++) {
    const s = (lo + hi) / 2
    pts = []
    for (let py = s / 2; py < H; py += s * 0.866)
      for (let px = s / 2 + ((Math.round(py / (s * 0.866)) % 2) * s) / 2; px < W; px += s) if (at(px, py)) pts.push([px, py])
    if (pts.length > n) lo = s
    else hi = s
  }
  while (pts.length < n) pts.push(pts[Math.floor(Math.random() * pts.length)])
  // ordem de cima para baixo, esquerda para direita (é a ordem em que caem)
  pts = pts.slice(0, n).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  return pts.map(([px, py]) => new THREE.Vector3(((px - W / 2) / W) * width, 0, ((py - H / 2) / W) * width))
}

function grid(n: number, width: number) {
  const cols = 30
  const s = width / cols
  return Array.from({ length: n }, (_, i) => new THREE.Vector3((i % cols) * s - width / 2 + s / 2, 0, Math.floor(i / cols) * s - (Math.ceil(n / cols) * s) / 2))
}

export class TilesSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  mesh: THREE.InstancedMesh
  A: THREE.Vector3[] = []
  B: THREE.Vector3[] = []
  C: THREE.Vector3[] = []
  rnd = Array.from({ length: N }, () => [Math.random(), Math.random(), Math.random()])
  hop = new Float32Array(N)
  hopV = new Float32Array(N)
  dummy = new THREE.Object3D()
  ray = new THREE.Raycaster()
  plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  constructor(el: HTMLElement) {
    super(el)
    this.scene.background = new THREE.Color('#e3e0db')
    const geo = new RoundedBoxGeometry(0.16, 0.045, 0.16, 3, 0.02)
    const mat = new THREE.MeshStandardMaterial({ color: '#f4f1eb', roughness: 0.32, metalness: 0 })
    this.mesh = new THREE.InstancedMesh(geo, mat, N)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.mesh)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)
    const hemi = new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.6)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight('#fff6ea', 2.2)
    key.position.set(-4, 7, 3)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const sc = key.shadow.camera as THREE.OrthographicCamera
    sc.left = -6
    sc.right = 6
    sc.top = 6
    sc.bottom = -6
    key.shadow.radius = 4
    key.shadow.bias = -0.0004
    this.scene.add(key)
  }

  async init() {
    this.A = layout('445', N, 6.4)
    this.B = layout('50 mil', N, 8.2)
    this.C = grid(N, 6.4)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 52 : 32
    this.cam.updateProjectionMatrix()
  }

  update(p: number, c: Ctx, rect: Rect) {
    // câmera inclinada sobre a mesa, girando de leve ao longo da seção
    const ang = -0.25 + p * 0.5
    this.cam.position.set(Math.sin(ang) * 9, 8.2 - p * 1.2, Math.cos(ang) * 9)
    this.cam.lookAt(0, 0, 0.2)
    // cursor na mesa
    const m = this.local(c, rect)
    let hit: THREE.Vector3 | null = null
    if (m.inside) {
      this.ray.setFromCamera(new THREE.Vector2(m.x, m.y), this.cam)
      hit = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3())
    }
    const fallP = fit(p, 0.03, 0.36)
    const toB = fit(p, 0.42, 0.66)
    const toC = fit(p, 0.74, 0.94)
    for (let i = 0; i < N; i++) {
      const [r0, r1, r2] = this.rnd[i]
      // queda escalonada: cada peça tem sua vez
      const ti = fit(fallP, (i / N) * 0.75, (i / N) * 0.75 + 0.25)
      const drop = 1 - ti
      // quique: duas batidas cada vez menores
      const b = ti < 1 ? Math.abs(Math.sin(ti * Math.PI * 2.5)) * Math.pow(1 - ti, 2) * 0.35 : 0
      const y0 = drop * drop * 5 + b
      // A → B → C com um salto em arco, atraso por peça
      const kb = ease(fit(toB, r0 * 0.4, r0 * 0.4 + 0.6))
      const kc = ease(fit(toC, r1 * 0.4, r1 * 0.4 + 0.6))
      const pos = this.A[i].clone().lerp(this.B[i], kb).lerp(this.C[i], kc)
      const arc = Math.sin(Math.PI * kb) * (0.6 + r2) + Math.sin(Math.PI * kc) * (0.5 + r0 * 0.6)
      // a mão na mesa: as peças por perto pulam e caem de volta
      if (hit) {
        const dd = Math.hypot(pos.x - hit.x, pos.z - hit.z)
        if (dd < 0.55 && this.hop[i] < 0.02 && Math.abs(this.hopV[i]) < 0.1) this.hopV[i] = 2.2 * (1 - dd / 0.55) + 0.4
      }
      this.hopV[i] -= 9.8 * c.dt
      this.hop[i] = Math.max(0, this.hop[i] + this.hopV[i] * c.dt)
      if (this.hop[i] === 0 && this.hopV[i] < 0) this.hopV[i] = -this.hopV[i] * 0.3 < 0.25 ? 0 : -this.hopV[i] * 0.3
      const y = 0.0225 + y0 + arc + this.hop[i]
      this.dummy.position.set(pos.x, y, pos.z)
      const spin = drop * (r0 - 0.5) * 6 + Math.sin(Math.PI * kb) * (r1 - 0.5) * 3 + this.hop[i] * (r2 - 0.5) * 4
      this.dummy.rotation.set(spin * 0.7, (r2 - 0.5) * 0.2 + spin, spin * 0.5)
      const vis = ti > 0 ? 1 : 0
      this.dummy.scale.setScalar(vis)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
