import * as THREE from 'three'
import { Section, damp, fit, toScreen, type Ctx, type Rect } from '../y/core'
import { DISPLAY, PAL, raw } from './pal'

// A trajetória como montanha-russa: uma fita larga e colorida dá voltas no espaço, passando por
// placas com os nomes (D.O.M., Maní, El Celler de Can Roca, Mugaritz) e voltando para Goiânia.
// A câmera anda em cima da fita, olhando adiante; a fita torce ao longo do caminho, o céu muda de
// cor a cada trecho, e riscos de velocidade aparecem quando a rolagem acelera.

const STOPS = ['D.O.M.', 'MANÍ', 'EL CELLER DE CAN ROCA', 'MUGARITZ', 'GOIÂNIA']
const COLS = [PAL.cobalt, PAL.tomato, PAL.saffron, PAL.pink, PAL.pistachio]

export class RibbonSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(62, 1, 0.05, 400)
  curve: THREE.CatmullRomCurve3
  frames: { tangents: THREE.Vector3[]; normals: THREE.Vector3[]; binormals: THREE.Vector3[] }
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  streaks: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  u = 0
  lastU = 0
  speed = 0
  look = new THREE.Vector3()
  SEG = 1200

  constructor(el: HTMLElement) {
    super(el)
    // caminho: espiral larga que sobe e desce, com uma volta por estação
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 22; i++) {
      const t = i / 22
      const a = t * Math.PI * 4.2
      pts.push(new THREE.Vector3(Math.cos(a) * (26 + Math.sin(t * 9) * 8), Math.sin(t * 7.0) * 9 + Math.cos(t * 13) * 3, Math.sin(a) * (26 + Math.cos(t * 7) * 8) - t * 60))
    }
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    this.frames = this.curve.computeFrenetFrames(this.SEG, false)
    // fita: tira larga com torção ao longo do caminho
    const W = 1.6
    const pos: number[] = []
    const uv: number[] = []
    const nor: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= this.SEG; i++) {
      const t = i / this.SEG
      const P = this.curve.getPointAt(t)
      const { n, b } = this.frame(t)
      for (const s of [-1, 1]) {
        const v = P.clone().addScaledVector(b, (s * W) / 2)
        pos.push(v.x, v.y, v.z)
        nor.push(n.x, n.y, n.z)
        uv.push((s + 1) / 2, t)
      }
      if (i < this.SEG) {
        const k = i * 2
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    const cols = COLS.map(raw)
    const ribbon = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { uC: { value: cols }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
          void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `uniform vec3 uC[5]; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
          void main(){
            float t = vUv.y * 5.0;
            int i = int(clamp(floor(t), 0.0, 4.0));
            int j = int(clamp(floor(t) + 1.0, 0.0, 4.0));
            vec3 c = mix(uC[i], uC[j], smoothstep(0.75, 1.0, fract(t)));
            // faixas da pista
            float lane = step(0.47, vUv.x) * step(vUv.x, 0.53) * step(0.5, fract(vUv.y * 260.0 - uTime * 0.0));
            float edge = step(vUv.x, 0.05) + step(0.95, vUv.x);
            c = mix(c, vec3(0.953, 0.925, 0.875), max(lane, edge) * 0.9);
            vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
            float lam = 0.65 + 0.35 * abs(dot(n, normalize(vec3(0.3, 1.0, 0.4))));
            float fog = smoothstep(30.0, 140.0, length(vW - cameraPosition));
            gl_FragColor = vec4(mix(c * lam, vec3(0.95, 0.92, 0.87), fog * 0.7), 1.0);
          }`,
      }),
    )
    this.scene.add(ribbon)
    ;(this as any).ribbon = ribbon

    // céu
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uA: { value: raw(PAL.cream) }, uB: { value: raw(PAL.pink) } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform vec3 uA, uB; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(uB, uA, smoothstep(-0.4, 0.6, vP.y)), 1.0); }`,
      }),
    )
    this.scene.add(this.sky)

    // placas com os nomes, ao lado da fita
    STOPS.forEach((name, i) => {
      const t = (i + 0.62) / STOPS.length
      const P = this.curve.getPointAt(t)
      const { n, b } = this.frame(t)
      const cv = document.createElement('canvas')
      cv.width = 2048
      cv.height = 512
      const x = cv.getContext('2d')!
      x.fillStyle = PAL.ink
      x.fillRect(0, 0, 2048, 512)
      x.fillStyle = PAL.cream
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      let size = 380
      x.font = `900 ${size}px ${DISPLAY}`
      while (x.measureText(name).width > 1900) {
        size -= 10
        x.font = `900 ${size}px ${DISPLAY}`
      }
      x.fillText(name, 1024, 270)
      const tex = new THREE.CanvasTexture(cv)
      tex.anisotropy = 8
      tex.colorSpace = THREE.SRGBColorSpace
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
      sign.position.copy(P).addScaledVector(n, 2.4).addScaledVector(b, i % 2 ? 3.2 : -3.2)
      const ahead = this.curve.getPointAt(Math.max(0, t - 0.04))
      sign.lookAt(ahead.addScaledVector(n, 2.4))
      this.scene.add(sign)
    })

    // riscos de velocidade
    const N = 600
    const sp = new Float32Array(N * 6)
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage))
    this.streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0 }))
    this.streaks.frustumCulled = false
    ;(this.streaks as any).seed = Array.from({ length: N }, () => [Math.random(), (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2])
    this.scene.add(this.streaks)
  }

  // referencial da fita em t, com torção extra ao longo do caminho
  frame(t: number) {
    const i = Math.min(this.SEG, Math.round(t * this.SEG))
    const n0 = this.frames.normals[i]
    const b0 = this.frames.binormals[i]
    const T = this.frames.tangents[i]
    // usa o "para cima" do mundo para a fita não capotar, e soma uma torção suave
    const up = new THREE.Vector3(0, 1, 0)
    let b = new THREE.Vector3().crossVectors(T, up).normalize()
    if (b.lengthSq() < 0.1) b = b0.clone()
    let n = new THREE.Vector3().crossVectors(b, T).normalize()
    const tw = Math.sin(t * Math.PI * 6) * 0.5
    const q = new THREE.Quaternion().setFromAxisAngle(T, tw)
    b = b.applyQuaternion(q)
    n = n.applyQuaternion(q)
    void n0
    return { n, b, T }
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 75 : 62
    this.cam.updateProjectionMatrix()
  }

  update(p: number, c: Ctx, rect: Rect) {
    const target = fit(p, 0.02, 0.98) * 0.985
    this.u += (target - this.u) * damp(0.08, c.dt)
    this.speed += (Math.abs(this.u - this.lastU) / Math.max(c.dt, 1e-3) - this.speed) * damp(0.1, c.dt)
    this.lastU = this.u
    const P = this.curve.getPointAt(this.u)
    const { n } = this.frame(this.u)
    const m = this.local(c, rect)
    this.cam.position.copy(P).addScaledVector(n, 0.9)
    const ahead = this.curve.getPointAt(Math.min(1, this.u + 0.012))
    const fa = this.frame(Math.min(1, this.u + 0.012))
    ahead.addScaledVector(fa.n, 0.7)
    ahead.x += m.x * 2
    ahead.y += m.y * 1.2
    this.look.lerp(ahead, damp(0.2, c.dt))
    this.cam.up.copy(n)
    this.cam.lookAt(this.look)
    this.cam.fov = (rect.w / rect.h < 1 ? 75 : 62) + Math.min(20, this.speed * 300)
    this.cam.updateProjectionMatrix()
    // céu por trecho
    const k = Math.min(4, Math.floor(this.u * 5))
    const su = this.sky.material.uniforms
    su.uB.value.lerp(raw(COLS[(k + 2) % 5]), damp(0.04, c.dt))
    this.sky.position.copy(this.cam.position)
    // riscos: aparecem com a velocidade
    const S = this.streaks
    const pos = S.geometry.attributes.position as THREE.BufferAttribute
    const seed = (S as any).seed as number[][]
    const fwd = ahead.clone().sub(this.cam.position).normalize()
    const right = new THREE.Vector3().crossVectors(fwd, n).normalize()
    seed.forEach((s, i) => {
      const dz = ((s[0] - c.t * 0.8) % 1 + 1) % 1
      const base = this.cam.position.clone().addScaledVector(fwd, 2 + dz * 30).addScaledVector(right, s[1] * 8).addScaledVector(n, s[2] * 5)
      const tail = base.clone().addScaledVector(fwd, -0.4 - this.speed * 40)
      pos.setXYZ(i * 2, base.x, base.y, base.z)
      pos.setXYZ(i * 2 + 1, tail.x, tail.y, tail.z)
    })
    pos.needsUpdate = true
    S.material.opacity = Math.min(0.35, this.speed * 8)
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
