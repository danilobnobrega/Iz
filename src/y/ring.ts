import * as THREE from 'three'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from './core'

// "Trajetória": os lugares por onde o Ian passou estão impressos numa fita larga, em anel, que gira
// com a rolagem. A câmera fica um pouco acima: a frente do anel se lê; por cima dela aparece o lado
// de dentro da parte de trás, com o texto espelhado e na sombra. Termina em Goiânia.

const STOPS = [
  ['D.O.M.', 'São Paulo'],
  ['Maní', 'São Paulo'],
  ['El Celler de Can Roca', 'Girona'],
  ['Mugaritz', 'Errenteria'],
  ['Goiânia', 'de volta, 2015'],
]

export class RingSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  ring: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>
  floor: THREE.Mesh
  rot = 0
  tilt = 0

  constructor(el: HTMLElement) {
    super(el)
    this.scene.background = new THREE.Color('#e3e0db')
    // a fita impressa: um nome por "estação", espaçados igualmente
    const W = 8192
    const H = 512
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const x = cv.getContext('2d')!
    x.fillStyle = '#f1eee8'
    x.fillRect(0, 0, W, H)
    x.fillStyle = '#17130f'
    x.textBaseline = 'alphabetic'
    const n = STOPS.length
    STOPS.forEach(([name, city], i) => {
      const cx = ((i + 0.5) / n) * W
      x.textAlign = 'center'
      let size = 230
      x.font = `${size}px "Instrument Serif"`
      while (x.measureText(name).width > (W / n) * 0.86) {
        size -= 6
        x.font = `${size}px "Instrument Serif"`
      }
      x.fillText(name, cx, H * 0.66)
      x.font = `500 30px "JetBrains Mono Variable"`
      x.fillText(`${String(i + 1).padStart(2, '0')} · ${city.toUpperCase()}`, cx, H * 0.86)
      // fios finos nas bordas da fita
      x.fillRect((i / n) * W, H * 0.07, W / n, 2)
      x.fillRect((i / n) * W, H * 0.93, W / n, 2)
      x.fillRect((i / n) * W, H * 0.07, 2, H * 0.86)
    })
    const tex = new THREE.CanvasTexture(cv)
    tex.anisotropy = 8
    tex.colorSpace = THREE.NoColorSpace
    const geo = new THREE.CylinderGeometry(2.7, 2.7, 0.95, 256, 1, true)
    this.ring = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { tMap: { value: tex }, uLight: { value: new THREE.Vector3(0.4, 0.8, 0.7).normalize() } },
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vN; varying vec3 vW;
          void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tMap; uniform vec3 uLight; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
          void main(){
            vec3 n = normalize(vN);
            vec3 v = normalize(cameraPosition - vW);
            bool inner = dot(n, v) < 0.0;
            if (inner) n = -n;
            // por dentro o texto aparece espelhado (é o verso do papel)
            vec2 uv = vUv;
            vec3 c = texture2D(tMap, uv).rgb;
            float lam = max(dot(n, uLight), 0.0);
            float lit = inner ? 0.55 + 0.15 * lam : 0.78 + 0.3 * lam;
            // tinta vista por trás do papel: mais clara, como transparência
            if (inner) c = mix(c, vec3(0.95, 0.93, 0.9), 0.55);
            float rim = pow(1.0 - abs(dot(n, v)), 3.0);
            c = c * lit + rim * 0.04;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    )
    this.scene.add(this.ring)
    // sombra de contato macia sob o anel
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 10.0;
          float a = exp(-pow((r - 2.7) / 0.3, 2.0)) * 0.22 + exp(-pow((r - 2.7) / 1.1, 2.0)) * 0.06;
          gl_FragColor = vec4(0.09, 0.075, 0.06, a); }`,
      }),
    )
    sh.rotation.x = -Math.PI / 2
    sh.position.y = -0.5
    this.floor = sh
    this.scene.add(sh)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 44 : 28
    this.cam.updateProjectionMatrix()
  }

  update(p: number, c: Ctx, rect: Rect) {
    const n = STOPS.length
    // gira estação por estação, com uma pausa curta em cada nome
    const raw = fit(p, 0.08, 0.88) * (n - 1)
    const i0 = Math.floor(raw)
    const f = raw - i0
    const stepped = i0 + ease(fit(f, 0.25, 0.85))
    const target = -((stepped + 0.5) / n) * Math.PI * 2
    this.rot += (target - this.rot) * damp(0.1, c.dt)
    this.ring.rotation.y = this.rot
    const m = this.local(c, rect)
    this.tilt += ((m.inside ? m.y : 0) * 0.08 - this.tilt) * damp(0.06, c.dt)
    const enter = ease(fit(p, 0, 0.12))
    const leave = ease(fit(p, 0.9, 1))
    const dist = this.w / this.h < 1 ? 19 : 11
    this.cam.position.set(Math.sin(this.tilt) * 0.5, 1.55 + this.tilt * 4 + (1 - enter) * 2.5 - leave * 1.5, dist + (1 - enter) * 4 + leave * 3)
    this.cam.lookAt(0, -0.05, 0)
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
