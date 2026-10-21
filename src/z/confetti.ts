import * as THREE from 'three'
import { Section, damp, fit, toScreen, type Ctx, type Rect } from '../y/core'
import { PAL } from './pal'

// Fechamento: "520" e uma explosão de confete. Cada papelzinho é um retângulo que gira em torno de
// um eixo próprio enquanto cai (por isso pisca de cor ao virar), sofre arrasto do ar e balança de
// lado; o cursor é vento. Clique solta mais uma rajada de onde estiver o cursor.

const N = 2600

export class ConfettiSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  mesh: THREE.InstancedMesh
  p = new Float32Array(N * 3)
  v = new Float32Array(N * 3)
  ax = new Float32Array(N * 3)
  ang = new Float32Array(N)
  spin = new Float32Array(N)
  alive = new Uint8Array(N)
  next = 0
  dummy = new THREE.Object3D()
  fired = false
  wasDown = false
  mouse = new THREE.Vector3()
  lastMouse = new THREE.Vector3()

  constructor(el: HTMLElement) {
    super(el)
    this.scene.background = new THREE.Color(PAL.ink)
    const geo = new THREE.PlaneGeometry(0.16, 0.09)
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.05 })
    this.mesh = new THREE.InstancedMesh(geo, mat, N)
    const cols = [PAL.tomato, PAL.cobalt, PAL.saffron, PAL.pink, PAL.pistachio, PAL.cream]
    const col = new THREE.Color()
    for (let i = 0; i < N; i++) {
      this.mesh.setColorAt(i, col.set(cols[i % cols.length]))
      this.dummy.scale.setScalar(0)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#555566', 2.2))
    const d = new THREE.DirectionalLight('#ffffff', 1.8)
    d.position.set(2, 4, 5)
    this.scene.add(d)
    this.cam.position.set(0, 0, 8)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
  }

  burst(x: number, y: number, count: number, power: number) {
    for (let k = 0; k < count; k++) {
      const i = this.next
      this.next = (this.next + 1) % N
      this.alive[i] = 1
      this.p.set([x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 2], i * 3)
      const a = Math.random() * Math.PI * 2
      const s = power * (0.4 + Math.random())
      this.v.set([Math.cos(a) * s * 0.7, Math.abs(Math.sin(a)) * s + power * 0.4, (Math.random() - 0.5) * s * 0.6], i * 3)
      const axv = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      this.ax.set([axv.x, axv.y, axv.z], i * 3)
      this.ang[i] = Math.random() * 6.28
      this.spin[i] = (Math.random() - 0.5) * 22
    }
  }

  update(p: number, c: Ctx, rect: Rect) {
    const m = this.local(c, rect)
    const hy = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * 8
    const hx = hy * this.cam.aspect
    this.mouse.set(m.x * hx, m.y * hy, 0)
    const wind = this.mouse.clone().sub(this.lastMouse).divideScalar(Math.max(c.dt, 1e-3))
    this.lastMouse.copy(this.mouse)
    // a explosão principal quando a seção chega; volta a armar se a pessoa sobe
    if (p > 0.12 && !this.fired) {
      this.fired = true
      this.burst(-hx * 0.7, -hy * 1.05, 1000, 15)
      this.burst(hx * 0.7, -hy * 1.05, 1000, 15)
    }
    if (p < 0.05) this.fired = false
    if (c.ptr.down && !this.wasDown && m.inside) this.burst(this.mouse.x, this.mouse.y, 300, 8)
    this.wasDown = c.ptr.down
    const dt = Math.min(c.dt, 1 / 30)
    const q = new THREE.Quaternion()
    for (let i = 0; i < N; i++) {
      if (!this.alive[i]) continue
      const o = i * 3
      const ax = new THREE.Vector3(this.ax[o], this.ax[o + 1], this.ax[o + 2])
      this.ang[i] += this.spin[i] * dt
      // papel cai devagar e balança: arrasto forte, gravidade fraca, oscilação lateral
      const face = Math.abs(Math.cos(this.ang[i]))
      this.v[o + 1] -= 5.0 * dt
      const drag = 1 - (0.9 + face * 1.8) * dt
      this.v[o] *= drag
      this.v[o + 1] *= drag
      this.v[o + 2] *= drag
      this.v[o] += Math.sin(this.ang[i] * 0.5 + i) * 1.4 * dt
      // vento do cursor
      const dx = this.p[o] - this.mouse.x
      const dy = this.p[o + 1] - this.mouse.y
      const f = Math.exp(-(dx * dx + dy * dy) / 1.2)
      this.v[o] += wind.x * f * 0.08
      this.v[o + 1] += wind.y * f * 0.08
      this.p[o] += this.v[o] * dt
      this.p[o + 1] += this.v[o + 1] * dt
      this.p[o + 2] += this.v[o + 2] * dt
      if (this.p[o + 1] < -hy * 1.4) this.alive[i] = 0
      q.setFromAxisAngle(ax, this.ang[i])
      this.dummy.position.set(this.p[o], this.p[o + 1], this.p[o + 2])
      this.dummy.quaternion.copy(q)
      this.dummy.scale.setScalar(this.alive[i] ? 1 : 0)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    void damp
    void fit
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
