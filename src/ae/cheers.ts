import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Section, ease, fit, type Ctx, type Rect } from '../y/core'
import { FX } from './fx'
import { backdrop } from './backdrop'

// O brinde. Duas taças de espumante de vidro fino se aproximam com a rolagem e se tocam em câmera
// lenta; no choque, gotas saltam com gravidade, o líquido balança e as bolhas, que sobem o tempo
// todo do fundo de cada taça, aceleram. O cursor inclina as taças.

function flute() {
  const prof = [
    [0.0, 0.0], [0.38, 0.0], [0.4, 0.015], [0.39, 0.03], [0.05, 0.06], [0.035, 0.1], [0.03, 0.9], [0.045, 0.95], [0.09, 1.0],
    [0.17, 1.12], [0.21, 1.4], [0.215, 1.85], [0.205, 1.86], [0.2, 1.4], [0.16, 1.13], [0.08, 1.01], [0.0, 1.0],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  return new THREE.LatheGeometry(prof, 96)
}

export class CheersSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(32, 1, 0.01, 100)
  fx = new FX()
  glasses: THREE.Group[] = []
  bubbles!: THREE.InstancedMesh
  bub: { g: number; y: number; x: number; z: number; s: number; v: number }[] = []
  drops!: THREE.InstancedMesh
  dr: { p: THREE.Vector3; v: THREE.Vector3; life: number }[] = []
  dummy = new THREE.Object3D()
  hit = false
  slosh = 0
  // o espumante: opaco para a passada de transmissão (vidro dentro de vidro não aparece no three),
  // mas faz a refração de verdade: o raio da câmera entra no líquido, refrata e cai no painel de
  // luzes do fundo (plano z = -7, 40 x 20). Dourado pela espessura atravessada.
  liquid = new THREE.ShaderMaterial({
    uniforms: { tBack: { value: null as THREE.Texture | null }, uT: { value: 0 } },
    vertexShader: `varying vec3 vW, vN; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D tBack; uniform float uT; varying vec3 vW, vN;
      vec3 sampleBack(vec3 o, vec3 d){
        float t = (-7.0 - o.z) / min(d.z, -0.05);
        vec3 h = o + d * t;
        vec2 uv = vec2(h.x / 40.0 + 0.5, (h.y - 1.5) / 20.0 + 0.5);
        return texture2D(tBack, uv).rgb;
      }
      void main(){
        vec3 v = normalize(vW - cameraPosition);
        vec3 n = normalize(vN);
        if (dot(n, v) > 0.0) n = -n;
        float fres = pow(1.0 - abs(dot(n, v)), 3.0);
        // entra no líquido e sai pelo outro lado do corpo (aproximado como cilindro: inverte x/z)
        vec3 r1 = refract(v, n, 1.0 / 1.34);
        vec3 n2 = normalize(vec3(-n.x, 0.0, -n.z));
        vec3 r2 = refract(r1, -n2, 1.34);
        if (dot(r2, r2) < 0.01) r2 = reflect(r1, n2);
        vec3 bg = sampleBack(vW, r2);
        float thick = 0.45 + 0.55 * abs(dot(n, v));
        vec3 gold = vec3(1.0, 0.62, 0.16);
        vec3 tint = pow(gold, vec3(0.6 + thick * 1.4));
        vec3 col = bg * tint * 1.6 + vec3(0.09, 0.05, 0.01);
        // reflexo na borda
        col += vec3(1.0, 0.85, 0.6) * fres * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }`,
  })

  constructor(el: HTMLElement, r: THREE.WebGLRenderer) {
    super(el)
    const pm = new THREE.PMREMGenerator(r)
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture
    this.scene.environmentIntensity = 0.5
    this.scene.background = new THREE.Color('#0b0907')
    // vidro fino como superfície transparente (o líquido, com transmissão, aparece através dele)
    const gMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, roughness: 0.02, thickness: 0.03, ior: 1.5, clearcoat: 1, specularIntensity: 1 })
    // gotas fora da taça: pegam a luz (claras, douradas), não absorvem como o líquido no copo
    const lMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd98a').multiplyScalar(0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const lipMat = new THREE.MeshPhysicalMaterial({ color: '#d9d4cc', roughness: 0.08, metalness: 0, clearcoat: 1, envMapIntensity: 2.5 })
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group()
      g.add(new THREE.Mesh(flute(), gMat))
      // a borda polida da taça (o lábio fino serrilha na transmissão; um aro liso resolve e pega luz)
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.0045, 10, 128).rotateX(Math.PI / 2), lipMat)
      lip.position.y = 1.857
      g.add(lip)
      // corpo do líquido: um sólido de revolução (preenche a taça até 1,52), dourado pela espessura
      const fill = [[0, 1.0], [0.08, 1.01], [0.16, 1.13], [0.2, 1.4], [0.203, 1.52], [0, 1.52]].map(([x, y]) => new THREE.Vector2(x, y))
      const body = new THREE.Mesh(new THREE.LatheGeometry(fill, 96), this.liquid)
      g.add(body)
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.2, 64).rotateX(-Math.PI / 2), this.liquid)
      top.position.y = 1.52
      g.add(top)
      g.userData.top = top
      this.glasses.push(g)
      this.scene.add(g)
    }
    // bolhas
    // opacas: assim a taça (transmissiva) as enxerga; um brilho quente como bolha contra a luz
    // (desenhadas por cima: estão dentro do líquido, que é opaco para a profundidade)
    const bMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2a8').multiplyScalar(0.45), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), bMat, 240)
    for (let i = 0; i < 240; i++) this.bub.push({ g: i % 2, y: 1.12 + Math.random() * 0.4, x: (Math.random() - 0.5) * 0.06, z: (Math.random() - 0.5) * 0.06, s: 0.004 + Math.random() * 0.007, v: 0.12 + Math.random() * 0.15 })
    this.bubbles.renderOrder = 10
    this.scene.add(this.bubbles)
    // gotas do choque
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 10), lMat, 160)
    this.drops.count = 0
    this.scene.add(this.drops)
    // luzes
    const key = new THREE.SpotLight('#fff0d8', 50, 12, 0.6, 0.6, 1.4)
    key.position.set(-2, 4, 3)
    this.scene.add(key)
    const rim = new THREE.PointLight('#ffb36b', 8, 8)
    rim.position.set(1.5, 2.2, -2)
    this.scene.add(rim)
    // fundo: luzes quentes desfocadas
    const N = 160
    const p = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) p.set([(Math.random() - 0.5) * 12, Math.random() * 5 - 0.5, -5 - Math.random() * 5], i * 3)
    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const bk = new THREE.Points(
      bg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uH: { value: 900 } },
        vertexShader: `uniform float uH; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = uH * 0.09 * (6.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.45, d) * (0.5 + 0.5 * smoothstep(0.2, 0.48, d)); if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0, 0.7, 0.38) * a * 0.3, 1.0); }`,
      }),
    )
    bk.frustumCulled = false
    ;(this as any).bk = bk
    const back = backdrop(['#ffcf8a', '#ff9a4a', '#ffe7c0'], 420, '#6b4424')
    back.position.set(0, 1.5, -7)
    this.scene.add(back)
    this.liquid.uniforms.tBack.value = back.userData.tex
    this.fx.threshold = 1.0
    this.fx.final.uniforms.uBloom.value = 0.55
    this.fx.final.uniforms.uExposure.value = 1.15
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 50 : 32
    this.cam.updateProjectionMatrix()
    this.fx.resize(w, h, dpr)
    ;(this as any).bk.material.uniforms.uH.value = h
  }

  update(p: number, c: Ctx, rect: Rect) {
    const m = this.local(c, rect)
    // aproximação: as taças vêm dos lados e se tocam no meio da seção
    const k = ease(fit(p, 0.05, 0.5))
    const gap = 1.6 * (1 - k) + 0.205
    const tiltIn = 0.28
    const [A, B] = this.glasses
    A.position.set(-gap - 0.02, -0.2, 0)
    B.position.set(gap + 0.02, -0.25, 0.05)
    A.rotation.set(0, 0, -tiltIn * k - (m.inside ? m.x * 0.05 : 0))
    B.rotation.set(0, 0.3, tiltIn * k + (m.inside ? m.x * 0.05 : 0))
    // o toque: dispara as gotas uma vez
    if (k > 0.985 && !this.hit) {
      this.hit = true
      this.slosh = 1
      const at = new THREE.Vector3(0, 1.62, 0)
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 0.6 + Math.random() * 1.6
        this.dr.push({ p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.05, (Math.random() - 0.5) * 0.1)), v: new THREE.Vector3(Math.cos(a) * sp * 0.5, 1 + Math.random() * 1.8, Math.sin(a) * sp * 0.4), life: 1.5 })
      }
    }
    if (k < 0.9) this.hit = false
    // câmera lenta perto do toque
    const slow = 1 - Math.exp(-Math.pow((p - 0.52) / 0.06, 2)) * 0.8
    const dt = Math.min(c.dt, 1 / 30) * slow
    this.slosh *= Math.pow(0.2, dt)
    this.glasses.forEach((g, gi) => {
      const top = g.userData.top as THREE.Mesh
      top.rotation.set(Math.sin(c.t * 9 + gi) * 0.12 * this.slosh, 0, Math.cos(c.t * 8) * 0.12 * this.slosh)
    })
    // bolhas sobem (mais rápido depois do brinde)
    this.bub.forEach((b, i) => {
      b.y += b.v * dt * (1 + this.slosh * 3)
      if (b.y > 1.5) b.y = 1.12
      const g = this.glasses[b.g]
      const lp = new THREE.Vector3(b.x + Math.sin(c.t * 3 + i) * 0.004, b.y, b.z)
      g.localToWorld(lp)
      this.dummy.position.copy(lp)
      this.dummy.scale.setScalar(b.s * (0.6 + (b.y - 1.12)))
      this.dummy.updateMatrix()
      this.bubbles.setMatrixAt(i, this.dummy.matrix)
    })
    this.bubbles.instanceMatrix.needsUpdate = true
    // gotas com gravidade
    this.dr = this.dr.filter((d) => (d.life -= dt) > 0 && d.p.y > -0.5)
    this.dr.forEach((d, i) => {
      d.v.y -= 9.8 * dt
      d.p.addScaledVector(d.v, dt)
      this.dummy.position.copy(d.p)
      const s = 0.0045 + (i % 5) * 0.0018
      this.dummy.scale.set(s, s * (1 + Math.min(1.5, d.v.length() * 0.15)), s)
      this.dummy.lookAt(d.p.clone().add(d.v))
      this.dummy.updateMatrix()
      this.drops.setMatrixAt(i, this.dummy.matrix)
    })
    this.drops.count = this.dr.length
    this.drops.instanceMatrix.needsUpdate = true
    // câmera: começa larga e fecha no ponto do toque
    const z = ease(fit(p, 0, 0.6))
    this.cam.position.set(Math.sin(c.t * 0.1) * 0.2 + (m.inside ? m.x * 0.15 : 0), 1.5 - z * 0.1, 5 - z * 2.3)
    this.cam.lookAt(0, 1.25 + z * 0.25, 0)
    this.fx.final.uniforms.uFade.value = 1
  }

  render(c: Ctx, rect: Rect) {
    this.fx.render(c, rect, this.scene, this.cam)
  }
}
