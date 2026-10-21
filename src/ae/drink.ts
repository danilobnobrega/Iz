import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Section, ease, fit, type Ctx, type Rect } from '../y/core'
import { FX } from './fx'
import { backdrop } from './backdrop'

// O drinque no balcão do Grá. Copo baixo de vidro grosso com refração e gotas de condensação,
// líquido âmbar com absorção pela espessura, gelo, rodela de laranja na borda e as luzes da cidade
// desfocadas atrás. O cursor mexe no copo: a superfície inclina e ondula como líquido de verdade
// (mola amortecida) e o gelo balança junto.

function dropletsNormal() {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const x = c.getContext('2d')!
  x.fillStyle = 'rgb(128,128,255)'
  x.fillRect(0, 0, S, S)
  for (let i = 0; i < 1400; i++) {
    const px = Math.random() * S, py = Math.random() * S
    const r = 2 + Math.pow(Math.random(), 3) * 14
    const g = x.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r)
    // normal de gota: inclina para fora a partir do centro
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      const nx = 128 + Math.cos(a) * 90, ny = 128 + Math.sin(a) * 90
      x.fillStyle = `rgba(${nx | 0},${ny | 0},235,0.5)`
      x.beginPath()
      x.moveTo(px, py)
      x.arc(px, py, r, a, a + Math.PI / 3)
      x.fill()
    }
    void g
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

function orangeTex() {
  const S = 512
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const x = c.getContext('2d')!
  x.fillStyle = '#e8781e'
  x.beginPath()
  x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = '#f7e7c8'
  x.beginPath()
  x.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2)
  x.fill()
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2
    x.fillStyle = i % 2 ? '#f6a339' : '#f39a2e'
    x.beginPath()
    x.moveTo(S / 2, S / 2)
    x.arc(S / 2, S / 2, S * 0.42, a + 0.03, a + (Math.PI * 2) / 11 - 0.03)
    x.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class DrinkSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
  fx = new FX()
  glass = new THREE.Group()
  surface!: THREE.Mesh
  surfaceMat!: THREE.MeshPhysicalMaterial
  ice: THREE.Mesh[] = []
  tilt = new THREE.Vector2()
  tiltV = new THREE.Vector2()
  lastM = new THREE.Vector2()
  bokeh!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  ripple = 0
  back!: THREE.Mesh
  rippleT = 0
  top!: THREE.Mesh

  constructor(el: HTMLElement, r: THREE.WebGLRenderer) {
    super(el)
    const pm = new THREE.PMREMGenerator(r)
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture
    this.scene.environmentIntensity = 0.6
    this.scene.background = new THREE.Color('#0a0807')

    // balcão de mármore escuro
    this.top = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.1, 160), new THREE.MeshPhysicalMaterial({ color: '#16110d', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.22, envMapIntensity: 1.4 }))
    this.top.position.y = -0.05
    this.scene.add(this.top)

    // copo baixo: perfil girado (parede grossa, fundo pesado)
    const prof = [
      [0.0, 0.0], [0.36, 0.0], [0.385, 0.02], [0.39, 0.9], [0.375, 0.92], [0.36, 0.9], [0.355, 0.16], [0.33, 0.13], [0.0, 0.13],
    ].map(([x, y]) => new THREE.Vector2(x, y))
    const gGeo = new THREE.LatheGeometry(prof, 128)
    const drops = dropletsNormal()
    drops.repeat.set(3, 2)
    const gMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, roughness: 0.03, thickness: 0.35, ior: 1.52, normalMap: drops, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1 })
    const glassMesh = new THREE.Mesh(gGeo, gMat)
    this.glass.add(glassMesh)

    // líquido: corpo âmbar e uma superfície que inclina
    const lGeo = new THREE.CylinderGeometry(0.352, 0.352, 0.5, 96, 1, true)
    lGeo.translate(0, 0.13 + 0.25, 0)
    const lMat = new THREE.MeshPhysicalMaterial({ color: '#ffb35c', transmission: 1, roughness: 0.05, thickness: 0.7, ior: 1.34, attenuationColor: new THREE.Color('#e5822e'), attenuationDistance: 0.9, side: THREE.DoubleSide })
    this.glass.add(new THREE.Mesh(lGeo, lMat))
    this.surfaceMat = lMat.clone()
    this.surfaceMat.side = THREE.DoubleSide
    this.surfaceMat.onBeforeCompile = (s) => {
      s.uniforms.uTilt = { value: this.tilt }
      s.uniforms.uRip = { value: 0 }
      s.uniforms.uRipT = { value: 0 }
      this.surfaceMat.userData.s = s
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uTilt; uniform float uRip, uRipT;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = position;
           float rr = length(position.xz);
           transformed.y += position.x * uTilt.x + position.z * uTilt.y + sin(rr * 40.0 - uRipT * 9.0) * uRip * 0.012 * exp(-uRipT * 1.5);`,
        )
    }
    this.surface = new THREE.Mesh(new THREE.CircleGeometry(0.352, 96, 0).rotateX(-Math.PI / 2), this.surfaceMat)
    this.surface.position.y = 0.63
    this.glass.add(this.surface)

    // gelo
    const iceMat = new THREE.MeshPhysicalMaterial({ color: '#f4fbff', transmission: 1, roughness: 0.12, thickness: 0.25, ior: 1.31 })
    for (let i = 0; i < 3; i++) {
      const cube = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.2, 0.22, 4, 0.04), iceMat)
      cube.userData.base = new THREE.Vector3((i - 1) * 0.15, 0.6, (i % 2) * 0.1 - 0.05)
      cube.rotation.set(Math.random(), Math.random() * 6, Math.random() * 0.5)
      this.ice.push(cube)
      this.glass.add(cube)
    }
    // rodela de laranja presa na borda
    const orange = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 64), [new THREE.MeshStandardMaterial({ color: '#e8781e', roughness: 0.5 }), new THREE.MeshPhysicalMaterial({ map: orangeTex(), roughness: 0.35, transmission: 0.3, thickness: 0.01 }), new THREE.MeshPhysicalMaterial({ map: orangeTex(), roughness: 0.35 })])
    orange.rotation.set(Math.PI / 2, 0.3, 0.1)
    orange.position.set(0.3, 0.92, 0.12)
    this.glass.add(orange)
    this.scene.add(this.glass)

    // luzes
    const key = new THREE.SpotLight('#ffd9a8', 40, 10, 0.5, 0.6, 1.5)
    key.position.set(-1.8, 2.6, 1.6)
    key.target = this.glass
    this.scene.add(key)
    const rim = new THREE.PointLight('#7fb2ff', 6, 6)
    rim.position.set(1.2, 1.2, -1.6)
    this.scene.add(rim)
    const under = new THREE.PointLight('#ff9a4a', 0.7, 1.6)
    under.position.set(0, 0.3, 0.6)
    this.scene.add(under)

    // luzes da cidade fora de foco, atrás
    const N = 260
    const p = new Float32Array(N * 3)
    const col = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      p.set([(Math.random() - 0.5) * 14, Math.random() * 4 - 0.6, -4 - Math.random() * 6], i * 3)
      const c = new THREE.Color().setHSL(0.06 + Math.random() * 0.08 + (Math.random() < 0.2 ? 0.5 : 0), 0.8, 0.6)
      col.set([c.r, c.g, c.b], i * 3)
    }
    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.BufferAttribute(p, 3))
    bg.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.bokeh = new THREE.Points(
      bg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: { uDpr: { value: 1 }, uH: { value: 900 } },
        vertexShader: `uniform float uDpr, uH; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = uH * 0.08 * uDpr * (6.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.46, d) * (0.55 + 0.45 * smoothstep(0.25, 0.48, d)); if (a < 0.01) discard; gl_FragColor = vec4(vC * a * 0.35, 1.0); }`,
      }),
    )
    this.bokeh.frustumCulled = false
    // fundo opaco com as luzes da cidade desfocadas (o vidro refrata isso)
    this.back = backdrop(['#ffb35c', '#ff8a3c', '#ffd8a0', '#7fb2ff'], 520, '#6a3f22')
    this.scene.add(this.back)
    // o balcão reflete o salão quente (o próprio fundo), não a sala branca padrão
    const benv = pm.fromEquirectangular(this.back.userData.tex).texture
    ;(this.top.material as THREE.MeshPhysicalMaterial).envMap = benv
    this.fx.threshold = 1.0
    this.fx.final.uniforms.uBloom.value = 0.5
    this.fx.final.uniforms.uExposure.value = 1.1
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 46 : 30
    this.cam.updateProjectionMatrix()
    this.fx.resize(w, h, dpr)
    this.bokeh.material.uniforms.uDpr.value = dpr
    this.bokeh.material.uniforms.uH.value = h
  }

  update(p: number, c: Ctx, rect: Rect) {
    const m = this.local(c, rect)
    // mola do líquido: o movimento do cursor empurra a superfície, que oscila e acalma
    const mv = new THREE.Vector2(m.x - this.lastM.x, m.y - this.lastM.y)
    this.lastM.set(m.x, m.y)
    if (m.inside) {
      this.tiltV.x -= mv.x * 0.8
      this.tiltV.y += mv.y * 0.8
      if (mv.length() > 0.02) {
        this.ripple = Math.min(1, this.ripple + mv.length() * 4)
        this.rippleT = 0
      }
    }
    const dt = Math.min(c.dt, 1 / 30)
    this.tiltV.addScaledVector(this.tilt, -60 * dt)
    this.tiltV.multiplyScalar(Math.pow(0.08, dt))
    this.tilt.addScaledVector(this.tiltV, dt)
    this.tilt.clampLength(0, 0.35)
    this.rippleT += dt
    this.ripple *= Math.pow(0.4, dt)
    const s = this.surfaceMat.userData.s
    if (s) {
      s.uniforms.uRip.value = this.ripple
      s.uniforms.uRipT.value = this.rippleT
    }
    this.ice.forEach((ic, i) => {
      const b = ic.userData.base as THREE.Vector3
      ic.position.set(b.x + this.tilt.x * 0.2, b.y + b.x * this.tilt.x + b.z * this.tilt.y + Math.sin(c.t * 1.3 + i * 2) * 0.006, b.z + this.tilt.y * 0.2)
      ic.rotation.x += this.tiltV.y * dt * 0.5
      ic.rotation.z -= this.tiltV.x * dt * 0.5
    })
    this.glass.rotation.y = c.t * 0.05
    // câmera macro que gira em volta do copo com a rolagem
    const a = -0.6 + ease(fit(p, 0, 1)) * 1.2
    const dist = 3.6 - ease(fit(p, 0, 0.6)) * 0.9
    this.cam.position.set(Math.sin(a) * dist, 0.75 + Math.cos(a * 2) * 0.08 + (m.inside ? m.y * 0.06 : 0), Math.cos(a) * dist)
    this.cam.lookAt(0, this.w < this.h ? 0.12 : 0.45, 0)
    // o fundo fica sempre atrás do copo, de frente para a câmera
    this.back.position.copy(this.cam.position).multiplyScalar(-2.4).setY(1.5)
    this.back.lookAt(this.cam.position)
    this.fx.final.uniforms.uFade.value = 1
  }

  render(c: Ctx, rect: Rect) {
    this.fx.render(c, rect, this.scene, this.cam)
  }
}
