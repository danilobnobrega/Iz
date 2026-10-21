import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from '../y/core'

// "As casas": escultura de sombra. Centenas de blocos soltos no ar, sem forma nenhuma vistos da
// câmera, ficam exatamente nos raios entre uma lâmpada e a parede: a sombra que eles projetam
// escreve o nome da casa. Rolando, os blocos voam para as posições da próxima casa e a sombra se
// refaz; a câmera gira em volta para mostrar que, de frente, é só bagunça.

const N = 900
const LIGHT = new THREE.Vector3(0, 0.6, 7.5)
const WALL_Z = -3

function targets(name: string) {
  const W = 1400, H = 420
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.fillStyle = '#000'
  x.fillRect(0, 0, W, H)
  x.fillStyle = '#fff'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  let size = 360
  x.font = `600 ${size}px "Fraunces Variable"`
  while (x.measureText(name).width > W * 0.92) {
    size -= 6
    x.font = `600 ${size}px "Fraunces Variable"`
  }
  x.fillText(name, W / 2, H / 2 + size * 0.06)
  const d = x.getImageData(0, 0, W, H).data
  // grade fina dentro das letras
  const pts: THREE.Vector3[] = []
  let step = 14
  for (let it = 0; it < 20; it++) {
    pts.length = 0
    for (let py = step / 2; py < H; py += step) for (let px = step / 2; px < W; px += step) if (d[(Math.floor(py) * W + Math.floor(px)) * 4] > 128) pts.push(new THREE.Vector3(px, py, 0))
    if (pts.length > N * 1.05) step *= 1.06
    else if (pts.length < N * 0.95) step *= 0.95
    else break
  }
  while (pts.length < N) pts.push(pts[Math.floor(Math.random() * pts.length)].clone())
  pts.length = N
  // cada ponto da parede vira um bloco em algum lugar do raio lâmpada → parede
  return pts.map((p) => {
    const wall = new THREE.Vector3(((p.x - W / 2) / W) * 13, -((p.y - H / 2) / W) * 13 + 0.6, WALL_Z)
    const t = 0.25 + Math.random() * 0.55
    const pos = LIGHT.clone().lerp(wall, t)
    // tamanho para a sombra ter o tamanho certo na parede
    const s = (step / W) * 13 * t * 1.55
    return { pos, s }
  })
}

export class ShadowSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
  mesh: THREE.InstancedMesh
  sets: { pos: THREE.Vector3; s: number }[][] = []
  dummy = new THREE.Object3D()
  rnd = Array.from({ length: N }, () => [Math.random(), Math.random(), Math.random()])
  orbit = 0
  cap: HTMLElement | null
  capI = -1

  constructor(el: HTMLElement, private names: string[], private lines: string[]) {
    super(el)
    this.cap = el.querySelector('.aa-house')
    this.scene.background = new THREE.Color('#0b0908')
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), new THREE.MeshStandardMaterial({ color: '#e9dfcf', roughness: 0.95 }))
    wall.position.z = WALL_Z
    wall.receiveShadow = true
    this.scene.add(wall)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.9 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -3.2
    floor.receiveShadow = true
    this.scene.add(floor)
    const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.12)
    const mat = new THREE.MeshStandardMaterial({ color: '#c9a77a', roughness: 0.45, metalness: 0.1 })
    this.mesh = new THREE.InstancedMesh(geo, mat, N)
    this.mesh.castShadow = true
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    // a lâmpada: um ponto de luz forte e pequeno, para a sombra ficar nítida
    const lamp = new THREE.SpotLight('#fff1dc', 220, 30, 0.75, 0.25, 1.6)
    lamp.position.copy(LIGHT)
    lamp.target.position.set(0, 0.6, WALL_Z)
    lamp.castShadow = true
    lamp.shadow.mapSize.set(2048, 2048)
    lamp.shadow.bias = -0.0003
    lamp.shadow.radius = 1.5
    this.scene.add(lamp, lamp.target)
    this.scene.add(new THREE.AmbientLight('#4a3a30', 0.6))
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshBasicMaterial({ color: '#fff6e6' }))
    bulb.position.copy(LIGHT)
    this.scene.add(bulb)
  }

  async init() {
    await document.fonts.load('600 80px "Fraunces Variable"')
    this.sets = this.names.map((n) => targets(n))
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 60 : 36
    this.cam.updateProjectionMatrix()
  }

  update(p: number, c: Ctx, rect: Rect) {
    const n = this.names.length
    const raw = fit(p, 0.03, 0.97) * (n - 1)
    const i = Math.min(n - 2, Math.floor(raw))
    const f = raw - i
    const k = ease(fit(f, 0.45, 0.95))
    const A = this.sets[i]
    const B = this.sets[i + 1]
    const m = this.local(c, rect)
    // a câmera gira em volta da escultura entre uma casa e outra, e volta de frente para ler
    const swing = Math.sin(Math.PI * fit(f, 0.3, 1.0))
    this.orbit += ((m.inside ? m.x * 0.25 : 0) + swing * 0.9 - this.orbit) * damp(0.06, c.dt)
    const dist = this.w / this.h < 1 ? 15 : 12.5
    this.cam.position.set(Math.sin(this.orbit) * dist * 0.85 + 1.8, 1.2 + (m.inside ? m.y * 0.6 : 0), Math.cos(this.orbit) * dist * 0.85 + 2.5)
    this.cam.lookAt(0, 0.2, WALL_Z + 2)
    for (let j = 0; j < N; j++) {
      const a = A[j], b = B[j]
      const [r0, r1, r2] = this.rnd[j]
      const kj = ease(fit(k, r0 * 0.35, r0 * 0.35 + 0.65))
      const pos = a.pos.clone().lerp(b.pos, kj)
      // no meio do voo, um arco para fora
      pos.x += Math.sin(Math.PI * kj) * (r1 - 0.5) * 3
      pos.y += Math.sin(Math.PI * kj) * (r2 - 0.2) * 2
      this.dummy.position.copy(pos)
      const tumble = Math.sin(Math.PI * kj) * 3
      this.dummy.rotation.set(r0 * 6 + tumble, r1 * 6 + tumble * 0.7, r2 * 6)
      this.dummy.scale.setScalar(a.s + (b.s - a.s) * kj)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(j, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    const show = f > 0.75 ? i + 1 : i
    if (this.cap && this.capI !== show) {
      this.capI = show
      const target = this.cap.querySelector<HTMLElement>('.y-in') ?? this.cap
      target.textContent = `${String(show + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')} · ${this.lines[show]}`
    }
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
