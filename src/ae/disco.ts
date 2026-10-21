import * as THREE from 'three'
import { Section, damp, ease, fit, type Ctx, type Rect } from '../y/core'
import { FX } from './fx'

// A pista. Um globo de espelhos de verdade: centenas de plaquinhas planas, cada uma refletindo os
// refletores coloridos. Os pontos de luz que correm pelas paredes são calculados por reflexão:
// para cada plaquinha virada para um refletor, a direção refletida vira um ponto de luz onde bate
// na sala. A frase está pintada na parede do fundo e os pontos passam por cima dela.
// O cursor move o refletor principal; rolando, o globo gira mais rápido e as cores mudam.

const FACETS = 220

const ROOM_FRAG = /* glsl */ `
  uniform vec3 uDirs[${FACETS}];
  uniform mat3 uRot;
  uniform vec3 uBall, uL1, uL2, uL3, uC1, uC2, uC3;
  uniform sampler2D tText; uniform float uHasText, uSharp, uOn;
  varying vec3 vW; varying vec2 vUv;
  void main(){
    vec3 d = normalize(vW - uBall);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${FACETS}; i++) {
      vec3 n = uRot * uDirs[i];
      // cada refletor: se a plaquinha está virada para ele, a luz sai na direção refletida
      float f1 = step(0.0, dot(n, uL1));
      vec3 r1 = reflect(-uL1, n);
      acc += uC1 * f1 * exp((dot(d, r1) - 1.0) * uSharp);
      float f2 = step(0.0, dot(n, uL2));
      vec3 r2 = reflect(-uL2, n);
      acc += uC2 * f2 * exp((dot(d, r2) - 1.0) * uSharp);
      float f3 = step(0.0, dot(n, uL3));
      vec3 r3 = reflect(-uL3, n);
      acc += uC3 * f3 * exp((dot(d, r3) - 1.0) * uSharp);
    }
    vec3 wall = vec3(0.045, 0.04, 0.05);
    if (uHasText > 0.5) {
      float t = texture2D(tText, vUv).r;
      wall = mix(wall, vec3(0.75, 0.72, 0.68), t);
    }
    // a sala só existe onde a luz bate (e um pouquinho de luz ambiente)
    vec3 col = wall * (0.12 + acc * 2.2 * uOn);
    gl_FragColor = vec4(col, 1.0);
  }`

export class DiscoSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(42, 1, 0.05, 100)
  fx = new FX()
  ball = new THREE.Group()
  dirs: THREE.Vector3[] = []
  roomMats: THREE.ShaderMaterial[] = []
  rot = 0
  speed = 0.25
  L1 = new THREE.Vector3(-0.6, 0.5, 0.6).normalize()

  constructor(el: HTMLElement) {
    super(el)
    this.scene.background = new THREE.Color('#040305')
    // plaquinhas de espelho em faixas de latitude
    const tiles: THREE.Matrix4[] = []
    const R = 1
    const rows = 18
    for (let i = 0; i < rows; i++) {
      const lat = -Math.PI / 2 + ((i + 0.5) / rows) * Math.PI
      const ring = Math.max(1, Math.round(Math.cos(lat) * rows * 2))
      for (let j = 0; j < ring; j++) {
        const lon = (j / ring) * Math.PI * 2 + (i % 2) * 0.08
        const n = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon))
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), n, new THREE.Vector3(0, 1, 0))
        // colada à mão: cada plaquinha um pouco torta, cada uma pega a luz num momento
        m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, 0)))
        m.setPosition(n.clone().multiplyScalar(R))
        tiles.push(m)
      }
    }
    const tileGeo = new THREE.PlaneGeometry(0.155, 0.155)
    tileGeo.rotateY(Math.PI)
    const tileMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.12, envMapIntensity: 2.2 })
    const inst = new THREE.InstancedMesh(tileGeo, tileMat, tiles.length)
    tiles.forEach((m, i) => inst.setMatrixAt(i, m))
    // cada plaquinha com um tom levemente diferente (vidro espelhado não é perfeito)
    const cc = new THREE.Color()
    tiles.forEach((_, i) => inst.setColorAt(i, cc.setHSL(0.6, 0.05, 0.7 + Math.random() * 0.25)))
    this.ball.add(inst)
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.985, 48, 32), new THREE.MeshBasicMaterial({ color: '#080808' }))
    this.ball.add(core)
    this.ball.position.set(0, 2.2, -1)
    this.scene.add(this.ball)
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3, 8), new THREE.MeshStandardMaterial({ color: '#444', metalness: 1, roughness: 0.4 }))
    rod.position.set(0, 4.7, -1)
    this.scene.add(rod)
    // ambiente colorido para as plaquinhas refletirem (os refletores)
    const envScene = new THREE.Scene()
    const mkLamp = (col: string, pos: THREE.Vector3, rad: number) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(6) }))
      s.position.copy(pos)
      envScene.add(s)
    }
    mkLamp('#ff3fa4', new THREE.Vector3(-6, 4, 6), 1.1)
    mkLamp('#35d6ff', new THREE.Vector3(6, 2, 5), 1.1)
    mkLamp('#ffb547', new THREE.Vector3(0, 6, -6), 1.1)
    // dezenas de refletores pequenos pela casa: o globo cintila em vez de mostrar 3 manchas
    const pal = ['#ff3fa4', '#35d6ff', '#ffb547', '#ffffff', '#9a6bff', '#ff7a3d']
    for (let i = 0; i < 46; i++) {
      const d = new THREE.Vector3().randomDirection()
      d.y = Math.abs(d.y) * 0.8 - 0.1
      mkLamp(pal[i % pal.length], d.normalize().multiplyScalar(9), 0.28 + Math.random() * 0.25)
    }
    envScene.background = new THREE.Color('#14111a')
    ;(this as any).envScene = envScene
    // direções das plaquinhas para o cálculo dos pontos (subamostra)
    for (let k = 0; k < FACETS; k++) {
      const m = tiles[Math.floor((k / FACETS) * tiles.length)]
      this.dirs.push(new THREE.Vector3().setFromMatrixPosition(m).normalize())
    }
    // a sala: chão, paredes e a parede do fundo com a frase
    const cv = document.createElement('canvas')
    cv.width = 2048
    cv.height = 1024
    const x = cv.getContext('2d')!
    x.fillStyle = '#000'
    x.fillRect(0, 0, 2048, 1024)
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.font = 'italic 260px "Instrument Serif"'
    x.fillText('Nada de', 1024, 470)
    x.fillText('acomodação.', 1024, 760)
    const tt = new THREE.CanvasTexture(cv)
    const mkRoom = (w: number, h: number, pos: THREE.Vector3, rotY: number, rotX: number, text: boolean) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: ROOM_FRAG,
        uniforms: {
          uDirs: { value: this.dirs },
          uRot: { value: new THREE.Matrix3() },
          uBall: { value: this.ball.position },
          uL1: { value: this.L1 },
          uL2: { value: new THREE.Vector3(0.7, 0.3, 0.6).normalize() },
          uL3: { value: new THREE.Vector3(0.0, 0.6, -0.8).normalize() },
          uC1: { value: new THREE.Color('#ff3fa4') },
          uC2: { value: new THREE.Color('#35d6ff') },
          uC3: { value: new THREE.Color('#ffb547') },
          tText: { value: tt },
          uHasText: { value: text ? 1 : 0 },
          uSharp: { value: 2600 },
          uOn: { value: 1 },
        },
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
      mesh.position.copy(pos)
      mesh.rotation.set(rotX, rotY, 0)
      this.scene.add(mesh)
      this.roomMats.push(mat)
    }
    mkRoom(16, 8, new THREE.Vector3(0, 2.5, -6), 0, 0, true)
    mkRoom(16, 16, new THREE.Vector3(0, -1.5, -0), 0, -Math.PI / 2, false)
    mkRoom(16, 8, new THREE.Vector3(-7, 2.5, 0), Math.PI / 2, 0, false)
    mkRoom(16, 8, new THREE.Vector3(7, 2.5, 0), -Math.PI / 2, 0, false)
    this.fx.threshold = 0.8
    this.fx.final.uniforms.uBloom.value = 0.9
    this.fx.final.uniforms.uExposure.value = 1.2
  }

  async init(r: THREE.WebGLRenderer) {
    const pm = new THREE.PMREMGenerator(r)
    this.scene.environment = pm.fromScene((this as any).envScene, 0.02).texture
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 62 : 42
    this.cam.updateProjectionMatrix()
    this.fx.resize(w, h, dpr)
  }

  update(p: number, c: Ctx, rect: Rect) {
    const m = this.local(c, rect)
    this.speed += (0.25 + fit(p, 0.2, 0.8) * 0.6 - this.speed) * damp(0.03, c.dt)
    this.rot += this.speed * c.dt
    this.ball.rotation.y = this.rot
    const want = new THREE.Vector3(-0.6 + (m.inside ? m.x * 0.8 : 0), 0.5 + (m.inside ? m.y * 0.3 : 0), 0.6).normalize()
    this.L1.lerp(want, damp(0.06, c.dt)).normalize()
    const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(this.rot))
    const on = ease(fit(p, 0.0, 0.15))
    // cores giram pela paleta com a rolagem
    const hue = fit(p, 0.3, 0.9)
    this.roomMats.forEach((mt) => {
      mt.uniforms.uRot.value.copy(rot)
      mt.uniforms.uOn.value = on
      mt.uniforms.uC1.value.setHSL((0.92 + hue * 0.3) % 1, 0.9, 0.55)
      mt.uniforms.uC2.value.setHSL((0.53 + hue * 0.3) % 1, 0.9, 0.55)
    })
    // câmera: no meio da pista, olhando o globo e a parede; dança devagar
    const a = Math.sin(c.t * 0.25) * 0.15 + (p - 0.5) * 0.5
    this.cam.position.set(Math.sin(a) * 4.2, 0.4 + Math.sin(c.t * 0.4) * 0.05, 4.2 * Math.cos(a))
    this.cam.lookAt(0, 1.8 - p * 0.4, -3)
    this.fx.final.uniforms.uFade.value = 1
  }

  render(c: Ctx, rect: Rect) {
    this.fx.render(c, rect, this.scene, this.cam)
  }
}
