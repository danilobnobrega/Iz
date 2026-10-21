import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Section, damp, ease, fit, type Ctx, type Rect } from '../y/core'
import { FX } from './fx'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

RectAreaLightUniformsLib.init()

// O disco. Um toca-discos de nogueira e alumínio; o vinil tem brilho anisotrópico de verdade (o
// reflexo se abre em leque, como nos sulcos), faixas separadas por anéis lisos e um selo impresso
// com os princípios do grupo como faixas do lado A. Rolando, o braço desce e a agulha percorre as
// faixas; segurar e arrastar o disco faz scratch (a rotação segue a mão).

const TRACKS = ['Cuidado, não pompa', 'Linguagem, não regra', 'Local, sem ser óbvio', 'Nada de acomodação']

function anisoMap() {
  // direção do brilho: tangente aos círculos (sulcos); força menor nos anéis entre faixas
  const S = 1024
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const x = c.getContext('2d')!
  const img = x.createImageData(S, S)
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const u = (i / S) * 2 - 1, v = (j / S) * 2 - 1
      const r = Math.hypot(u, v) + 1e-5
      const tx = -v / r, ty = u / r
      const gap = [0.62, 0.74, 0.86].some((g) => Math.abs(r - g) < 0.006) ? 0.15 : 1
      const k = (j * S + i) * 4
      img.data[k] = (tx * 0.5 + 0.5) * 255
      img.data[k + 1] = (ty * 0.5 + 0.5) * 255
      img.data[k + 2] = gap * 255
      img.data[k + 3] = 255
    }
  x.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

function grooveRough() {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const x = c.getContext('2d')!
  x.fillStyle = 'rgb(90,90,90)'
  x.fillRect(0, 0, S, S)
  // microssulcos: anéis finos com rugosidade alternada
  for (let r = 0.36; r < 0.985; r += 0.0025) {
    x.strokeStyle = `rgb(${70 + Math.random() * 50},${70 + Math.random() * 50},${70 + Math.random() * 50})`
    x.lineWidth = 1
    x.beginPath()
    x.arc(S / 2, S / 2, (r * S) / 2, 0, Math.PI * 2)
    x.stroke()
  }
  // anéis lisos entre faixas
  for (const g of [0.62, 0.74, 0.86]) {
    x.strokeStyle = 'rgb(20,20,20)'
    x.lineWidth = 6
    x.beginPath()
    x.arc(S / 2, S / 2, (g * S) / 2, 0, Math.PI * 2)
    x.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

function labelTex() {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const x = c.getContext('2d')!
  x.fillStyle = '#d9462b'
  x.beginPath()
  x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = '#f6ecdc'
  x.textAlign = 'center'
  x.font = '400 190px "Instrument Serif"'
  x.fillText('Íz', S / 2, S * 0.36)
  x.font = '600 30px "JetBrains Mono Variable"'
  x.fillText('GRUPO ÍZ · LADO A · 33⅓', S / 2, S * 0.43)
  x.font = 'italic 40px "Instrument Serif"'
  TRACKS.forEach((t, i) => x.fillText(`${i + 1}. ${t}`, S / 2, S * 0.62 + i * 52))
  x.font = '500 22px "JetBrains Mono Variable"'
  x.fillText('GOIÂNIA · DESDE 2015', S / 2, S * 0.9)
  x.fillStyle = '#1a1412'
  x.beginPath()
  x.arc(S / 2, S / 2, 14, 0, Math.PI * 2)
  x.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export class RecordSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
  fx = new FX()
  disc = new THREE.Group()
  arm = new THREE.Group()
  rot = 0
  speed = 0
  dragging = false
  lastAng = 0
  ray = new THREE.Raycaster()
  cap: HTMLElement | null
  capI = -1

  constructor(el: HTMLElement, r: THREE.WebGLRenderer) {
    super(el)
    this.cap = el.querySelector('.ae-track')
    const pm = new THREE.PMREMGenerator(r)
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.02).texture
    this.scene.environmentIntensity = 0.55
    this.scene.background = new THREE.Color('#0c0a09')
    // móvel: nogueira
    const wood = new THREE.MeshPhysicalMaterial({ color: '#5a3520', roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 })
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.36, 3.6), wood)
    plinth.position.y = -0.18
    this.scene.add(plinth)
    const alu = new THREE.MeshStandardMaterial({ color: '#c9c6c0', metalness: 1, roughness: 0.28 })
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.1, 128), alu)
    platter.position.set(-0.45, 0.05, 0)
    this.scene.add(platter)
    // o disco
    const vinyl = new THREE.MeshPhysicalMaterial({
      color: '#0b0b0c',
      roughness: 0.32,
      roughnessMap: grooveRough(),
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
      anisotropy: 0.9,
      anisotropyMap: anisoMap(),
      envMapIntensity: 0.3,
    })
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.02, 160), [new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.5 }), vinyl, vinyl])
    disc.position.y = 0.11
    // o cilindro mapeia o topo em uv polar; giramos o grupo
    this.disc.add(disc)
    const label = new THREE.Mesh(new THREE.CircleGeometry(0.52, 96), new THREE.MeshStandardMaterial({ map: labelTex(), roughness: 0.75 }))
    label.rotation.x = -Math.PI / 2
    label.position.y = 0.1215
    this.disc.add(label)
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 24), alu)
    spindle.position.y = 0.16
    this.disc.add(spindle)
    this.disc.position.set(-0.45, 0, 0)
    this.scene.add(this.disc)
    // o braço
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.18, 48), alu)
    base.position.y = 0.09
    this.arm.add(base)
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 24), alu)
    tube.rotation.x = Math.PI / 2
    tube.position.set(0, 0.24, -1.05)
    this.arm.add(tube)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.32), new THREE.MeshStandardMaterial({ color: '#1b1b1d', metalness: 0.4, roughness: 0.4 }))
    head.position.set(0, 0.19, -2.15)
    this.arm.add(head)
    const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 32), alu)
    cw.rotation.x = Math.PI / 2
    cw.position.set(0, 0.24, 0.32)
    this.arm.add(cw)
    this.arm.position.set(1.45, 0, 1.1)
    this.scene.add(this.arm)
    // luzes de estúdio
    const key = new THREE.SpotLight('#ffe6c8', 60, 12, 0.55, 0.7, 1.4)
    key.position.set(-2.5, 4.5, 2.5)
    key.target = this.disc
    this.scene.add(key)
    const strip = new THREE.RectAreaLight('#fff5e8', 6, 4, 0.3)
    strip.position.set(1.5, 2.5, -2)
    strip.lookAt(0, 0, 0)
    this.scene.add(strip)
    this.fx.threshold = 1.1
    this.fx.final.uniforms.uBloom.value = 0.4
    this.fx.final.uniforms.uExposure.value = 1.15
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 50 : 30
    this.cam.updateProjectionMatrix()
    this.fx.resize(w, h, dpr)
  }

  update(p: number, c: Ctx, rect: Rect) {
    const m = this.local(c, rect)
    // braço: sai do descanso e desce no disco; depois percorre as faixas
    const drop = ease(fit(p, 0.05, 0.22))
    const play = fit(p, 0.22, 0.92)
    const restAng = 0.0
    const outer = 0.33
    const inner = 0.55
    this.arm.rotation.y = restAng + drop * outer + play * (inner - outer)
    this.arm.rotation.x = (1 - drop) * -0.05
    this.arm.position.y = (1 - drop) * 0.06
    const track = Math.min(TRACKS.length - 1, Math.floor(play * TRACKS.length))
    if (this.cap && this.capI !== (drop > 0.9 ? track : -1)) {
      this.capI = drop > 0.9 ? track : -1
      const t = this.cap.querySelector<HTMLElement>('.y-in') ?? this.cap
      t.innerHTML = this.capI < 0 ? '<small>Lado A</small>' : `<small>Faixa ${track + 1}</small>${TRACKS[track]}.`
    }
    // rotação: 33⅓ rpm quando a agulha está no disco; scratch com a mão
    this.ray.setFromCamera(new THREE.Vector2(m.x, m.y), this.cam)
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12), new THREE.Vector3())
    const onDisc = !!hit && Math.hypot(hit.x + 0.45, hit.z) < 1.5
    const ang = hit ? Math.atan2(hit.z, hit.x + 0.45) : 0
    if (c.ptr.down && m.inside && onDisc) {
      if (!this.dragging) this.lastAng = ang
      this.dragging = true
      let da = ang - this.lastAng
      if (da > Math.PI) da -= Math.PI * 2
      if (da < -Math.PI) da += Math.PI * 2
      this.lastAng = ang
      this.speed = -da / Math.max(c.dt, 1e-3)
    } else {
      this.dragging = false
      const target = drop > 0.9 ? 3.49 : 0
      this.speed += (target - this.speed) * damp(0.04, c.dt)
    }
    this.rot += this.speed * c.dt
    this.disc.rotation.y = -this.rot
    // câmera: começa alta e descreve um arco até ficar rente ao disco
    const a = ease(fit(p, 0, 1))
    this.cam.position.set(1.8 - a * 3.4 + (m.inside ? m.x * 0.2 : 0), 3.6 - a * 2.4, 3.4 - a * 0.6)
    this.cam.lookAt(-0.2 - a * 0.3, 0.05, -0.1)
    this.fx.final.uniforms.uFade.value = 1
  }

  render(c: Ctx, rect: Rect) {
    this.fx.render(c, rect, this.scene, this.cam)
  }
}
