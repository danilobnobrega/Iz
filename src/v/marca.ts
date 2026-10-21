import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Frame, Place } from './engine'
import { rt } from './post'
import { Label, toScreen, type Overlay } from './type'
import { fractureIz, outlineGeometry, type Piece } from './fracture'
import { clamp, damp, ease, fit, pad, smooth } from './util'

// Lugar 1 — a chegada. O "Íz" é uma pedra escura polida, quebrada em ~150 peças.
// Cada peça sente o cursor sozinha: sai pelo próprio eixo, gira um pouco, e as faces de quebra
// (mais claras e ásperas, como pedra partida de verdade) acendem por dentro em âmbar.
// Uma constelação liga as peças mais deslocadas; os números medem quanto cada uma saiu.

const NOISE = /* glsl */ `
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`

const PIECE_VERT_HEAD = /* glsl */ `
  attribute float aPiece; attribute vec3 aCenter;
  uniform sampler2D uState;
  varying vec3 vLocal; varying vec3 vLN; varying float vGlow; varying float vIntro;
  ${NOISE}
`
const PIECE_BEGIN = /* glsl */ `
  vec4 st0 = texelFetch(uState, ivec2(int(aPiece), 0), 0);
  vec4 qq = texelFetch(uState, ivec2(int(aPiece), 1), 0);
  vec4 st2 = texelFetch(uState, ivec2(int(aPiece), 2), 0);
  vec3 transformed = aCenter + st0.xyz + qrot(qq, position - aCenter);
  vLocal = position; vLN = normal; vGlow = st0.w; vIntro = st2.x;
`

export class Marca implements Place {
  name = 'marca'
  length = 1
  stops = [0]
  rt = rt(2, 2, 4)
  bloom = 0.9
  bloomStrength = 0.75
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  group = new THREE.Group()
  pieces: Piece[]
  n: number
  state: THREE.DataTexture
  stateData: Float32Array
  // física por peça
  t1: Float32Array
  t2: Float32Array
  disp: Float32Array
  dir: Float32Array
  phase: Float32Array
  mesh: THREE.Mesh
  core: THREE.Mesh<THREE.ShapeGeometry, THREE.ShaderMaterial>
  wall: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  outline: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>
  dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  depth: number
  introT = -1
  mouse = new THREE.Vector3(0, -9, 0)
  light = new THREE.Vector3(0, 0, 0)
  ray = new THREE.Raycaster()
  plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  w = 1
  h = 1
  // constelação
  links = new Map<string, { a: number; b: number; p: number; dir: number }>()
  numLabels: Label[] = []
  plexusSet: number[] = []
  queueT = 0
  lastStone = 0
  labels: { lead: Label; side: Label; mani: Label; hint: Label }
  shown = false
  vis = 0

  constructor(r: THREE.WebGLRenderer, ov: Overlay) {
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap
    const pm = new THREE.PMREMGenerator(r)
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.32
    this.scene.background = new THREE.Color(0x060505)

    const F = fractureIz(3, 0.36, 62, 11)
    this.pieces = F.pieces
    this.n = F.pieces.length
    this.depth = F.depth
    this.stateData = new Float32Array(this.n * 3 * 4)
    this.state = new THREE.DataTexture(this.stateData, this.n, 3, THREE.RGBAFormat, THREE.FloatType)
    this.state.needsUpdate = true
    this.t1 = new Float32Array(this.n)
    this.t2 = new Float32Array(this.n)
    this.disp = new Float32Array(this.n)
    this.dir = new Float32Array(this.n * 3)
    this.phase = new Float32Array(this.n * 3).map(() => Math.random() * Math.PI * 2)
    for (let i = 0; i < this.n; i++) this.stateData[(this.n + i) * 4 + 3] = 1 // quaternion identidade

    // pedra: face frontal polida e escura, faces de quebra claras e ásperas
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12 })
    mat.onBeforeCompile = (s) => {
      s.uniforms.uState = { value: this.state }
      s.uniforms.uTime = { value: 0 }
      mat.userData.shader = s
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\n' + PIECE_VERT_HEAD)
        .replace('#include <beginnormal_vertex>', `vec4 qn = texelFetch(uState, ivec2(int(aPiece), 1), 0); vec3 objectNormal = qrot(qn, normal);`)
        .replace('#include <begin_vertex>', PIECE_BEGIN)
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vLocal; varying vec3 vLN; varying float vGlow; varying float vIntro; uniform float uTime;\n' + NOISE,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          float dn = n3(vLocal * 7.0) * 0.65 + n3(vLocal * 23.0) * 0.35;
          float thr = vIntro * 1.25 - 0.1;
          if (dn > thr) discard;
          float burn = smoothstep(thr - 0.07, thr, dn) * step(vIntro, 0.999);`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float side = 1.0 - abs(normalize(vLN).z);
          side = smoothstep(0.62, 0.95, side);
          float fleck = smoothstep(0.78, 0.86, n3(vLocal * 90.0)) * 0.6 + n3(vLocal * 9.0) * 0.25;
          vec3 front = vec3(0.022, 0.02, 0.018) * (0.85 + fleck * 0.9);
          float grain = n3(vLocal * 140.0) * 0.5 + n3(vLocal * 37.0) * 0.5;
          vec3 broken = vec3(0.05, 0.05, 0.052) * (0.6 + grain * 0.8) + vec3(0.25) * step(0.93, n3(vLocal * 210.0));
          diffuseColor.rgb = mix(front, broken, side);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = mix(0.14 + n3(vLocal * 18.0) * 0.14, 0.92, side);`,
        )
        .replace(
          '#include <clearcoat_normal_fragment_begin>',
          `#include <clearcoat_normal_fragment_begin>`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec3 ember = vec3(1.0, 0.46, 0.16);
          float inner = vGlow * side * (0.65 + 0.35 * n3(vLocal * 12.0 + uTime * 0.4));
          totalEmissiveRadiance += ember * inner * 1.1;
          totalEmissiveRadiance += ember * burn * 6.0;`,
        )
      s.fragmentShader = s.fragmentShader.replace(
        '#include <clearcoat_fragment>',
        '#include <clearcoat_fragment>\n material.clearcoat *= (1.0 - side);',
      )
    }
    this.mesh = new THREE.Mesh(F.geo, mat)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    depthMat.onBeforeCompile = (s) => {
      s.uniforms.uState = { value: this.state }
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\n' + PIECE_VERT_HEAD)
        .replace('#include <begin_vertex>', PIECE_BEGIN)
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vIntro;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vIntro < 0.6) discard;')
    }
    this.mesh.customDepthMaterial = depthMat
    this.group.add(this.mesh)

    // núcleo: luz âmbar escondida dentro da pedra (cada peça encolhida no próprio centro), só aparece nas frestas
    const coreShapes = F.pieces.map((pc) => {
      const k = 0.9
      const m = ([x, y]: [number, number]) => new THREE.Vector2(pc.cx + (x - pc.cx) * k, pc.cy + (y - pc.cy) * k)
      const sh = new THREE.Shape(pc.poly[0].map(m))
      for (const h of pc.poly.slice(1)) sh.holes.push(new THREE.Path(h.map(m)))
      return sh
    })
    this.core = new THREE.Mesh(
      new THREE.ShapeGeometry(coreShapes, 6),
      new THREE.ShaderMaterial({
        uniforms: { uMouse: { value: new THREE.Vector3() }, uI: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uMouse; uniform float uI; uniform float uTime; varying vec3 vP;
          ${NOISE}
          void main(){
            float d = length(vP.xy - uMouse.xy);
            float f = smoothstep(1.3, 0.0, d);
            float fl = 0.6 + 0.4 * n3(vec3(vP.xy * 3.0, uTime * 0.35));
            gl_FragColor = vec4(vec3(1.0, 0.43, 0.14) * f * fl * uI * 1.6, 1.0);
          }`,
      }),
    )
    this.core.position.z = 0
    this.group.add(this.core)

    // traço da abertura
    this.outline = new THREE.LineSegments(
      outlineGeometry(F.mp, this.depth / 2 + 0.02),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uP: { value: 0 }, uFade: { value: 1 } },
        vertexShader: /* glsl */ `attribute float aDist; varying float vD; void main(){ vD = aDist; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform float uP; uniform float uFade; varying float vD;
          void main(){
            float on = step(vD, uP);
            float head = smoothstep(0.06, 0.0, uP - vD) * on;
            gl_FragColor = vec4(vec3(1.0, 0.82, 0.62) * (0.35 + head * 4.0) * on * uFade, 1.0);
          }`,
      }),
    )
    this.group.add(this.outline)
    this.scene.add(this.group)

    // parede ao fundo com uma poça de luz que segue o cursor devagar
    this.wall = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 24),
      new THREE.ShaderMaterial({
        uniforms: { uLight: { value: new THREE.Vector3() }, uI: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uLight; uniform float uI; uniform float uTime; varying vec3 vW;
          ${NOISE}
          void main(){
            float d = length(vW.xy - uLight.xy * 0.6);
            float pool = exp(-d * d * 0.09) * 0.07 + exp(-d * d * 0.6) * 0.025;
            float tex = 0.85 + 0.15 * n3(vec3(vW.xy * 1.7, 0.0)) + n3(vec3(vW.xy * 30.0, 1.0)) * 0.05;
            vec3 c = vec3(1.0, 0.78, 0.6) * pool * tex + vec3(0.006, 0.0055, 0.005);
            gl_FragColor = vec4(c * uI, 1.0);
          }`,
      }),
    )
    this.wall.position.z = -3.2
    this.wall.receiveShadow = false
    this.scene.add(this.wall)

    // poeira em suspensão
    const N = 600
    const dp = new Float32Array(N * 3)
    const dr = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      dp.set([(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, -2.5 + Math.random() * 5], i * 3)
      dr[i] = Math.random()
    }
    const dg = new THREE.BufferGeometry()
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
    dg.setAttribute('aR', new THREE.BufferAttribute(dr, 1))
    this.dust = new THREE.Points(
      dg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uLight: { value: new THREE.Vector3() }, uI: { value: 0 }, uDpr: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aR; uniform float uTime; uniform vec3 uLight; uniform float uDpr; varying float vA;
          void main(){
            vec3 p = position;
            p.y += mod(uTime * (0.02 + aR * 0.03) + aR * 6.0, 6.0) - 3.0 - position.y * 0.0;
            p.x += sin(uTime * 0.2 + aR * 40.0) * 0.15;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float l = exp(-pow(length(p.xy - uLight.xy * 0.6), 2.0) * 0.25);
            vA = l * (0.25 + aR * 0.75);
            gl_PointSize = (1.0 + aR * 2.2) * uDpr * (6.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uI; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vec3(1.0, 0.85, 0.7) * a * vA * uI * 0.5, 1.0); }`,
      }),
    )
    this.scene.add(this.dust)

    // luzes
    const key = new THREE.DirectionalLight(0xffe9d2, 2.4)
    key.position.set(-3.5, 4.2, 6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const sc = key.shadow.camera as THREE.OrthographicCamera
    sc.left = -2.6
    sc.right = 2.6
    sc.top = 2.2
    sc.bottom = -2.2
    sc.near = 2
    sc.far = 16
    key.shadow.bias = -0.0005
    key.shadow.normalBias = 0.015
    key.shadow.radius = 3
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fb4d6, 1.4)
    rim.position.set(5, 1.5, -3)
    this.scene.add(rim)
    const fill = new THREE.HemisphereLight(0xfff1e0, 0x1a1410, 0.12)
    this.scene.add(fill)

    this.cam.position.set(0, 0, 9)

    // constelação: 5 números
    for (let i = 0; i < 5; i++) this.numLabels.push(new Label(ov, '00', { size: 9.5, spacing: 0.6, dur: 0.15, spread: 0.3 }))
    this.labels = {
      lead: new Label(ov, '// Alta gastronomia\n// com alma regional', { size: 10.5, spacing: 0.5, dur: 0.9 }),
      side: new Label(ov, '// Ian Baiocchi & Domingos Ávila\n// Goiânia, desde 2015', { size: 10.5, spacing: 0.5, dur: 0.9 }),
      mani: new Label(
        ov,
        '////// Grupo Íz\n\nSete casas em Goiânia, cada uma com a sua cozinha. Uma régua só: cuidado com cada detalhe, sem pompa nenhuma.',
        { size: 11, spacing: 0.3, maxWidth: 270, lineHeight: 1.65, dur: 1.6 },
      ),
      hint: new Label(ov, 'Role para descer', { size: 10.5, spacing: 0.6, align: 'center', dur: 0.6 }),
    }
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.rt.setSize(Math.round(w * dpr), Math.round(h * dpr))
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
    const s = Math.min(1, (w / h) * 0.82)
    this.group.scale.setScalar(s)
    this.dust.material.uniforms.uDpr.value = dpr
  }

  intro() {
    this.introT = 0
  }

  hide() {
    this.vis = 0
    this.setLabels(false)
    this.numLabels.forEach((l) => (l.alpha = 0))
  }

  setLabels(on: boolean) {
    if (on === this.shown) return
    this.shown = on
    const L = this.labels
    L.lead.show(on)
    L.side.show(on, on ? 0.15 : 0)
    L.mani.show(on, on ? 0.3 : 0)
    L.hint.show(on, on ? 0.9 : 0)
  }

  update(local: number, f: Frame) {
    const dt = f.dt
    const t = f.t
    this.vis = f.vis
    if (this.introT >= 0) this.introT += dt
    const it = this.introT

    // saída para baixo (local > 0) e volta pelo laço (local < 0): as peças se soltam de cima para baixo
    const exit = local >= 0 ? fit(local, 0.04, 1.7) : fit(-local, 0.0, 0.9)
    const dirSign = local >= 0 ? 1 : -1

    // cursor projetado no plano da face
    let hov = 0
    if (f.pointer.inside && it > 3.2) {
      this.ray.setFromCamera(new THREE.Vector2(f.pointer.x, f.pointer.y), this.cam)
      const hit = new THREE.Vector3()
      this.plane.constant = -(this.depth / 2) * this.group.scale.x
      if (this.ray.ray.intersectPlane(this.plane, hit)) {
        hit.divideScalar(this.group.scale.x)
        this.mouse.lerp(hit, damp(0.35, dt))
        hov = 1 - exit
      }
    }
    this.light.lerp(f.pointer.inside ? this.mouse : new THREE.Vector3(0, 0.5, 0), damp(0.03, dt))

    const sd = this.stateData
    const N = this.n
    let glowSum = 0
    for (let i = 0; i < N; i++) {
      const p = this.pieces[i]
      const dx = p.cx - this.mouse.x
      const dy = p.cy - this.mouse.y
      const d = Math.hypot(dx, dy)
      const amt = 0.5 + (p.rand - 0.5) * 0.6
      const s = smooth(1.05, 0.12, d) * hov
      this.t1[i] = s * amt * 0.62
      this.t2[i] += (this.t1[i] - this.t2[i]) * damp(0.07, dt)
      this.disp[i] += (this.t2[i] - this.disp[i]) * damp(0.06, dt)
      const di = this.disp[i]
      if (s > 0.001) {
        const inv = 1 / Math.max(1e-4, Math.hypot(dx * 0.35, dy * 0.35, 1))
        this.dir[i * 3] = dx * 0.35 * inv
        this.dir[i * 3 + 1] = dy * 0.35 * inv
        this.dir[i * 3 + 2] = inv
      }
      // abertura: de baixo para cima
      let intro = 1
      if (it >= 0) intro = clamp((it - 0.7 - p.y01 * 1.5 - p.rand * 0.35) / 0.9)
      else intro = 0
      const introE = ease(intro)
      // saída
      const ord = dirSign > 0 ? 1 - p.y01 : p.y01
      const e = clamp(exit * 1.5 - ord * 0.5)
      const ee = e * e
      const breath = it > 4 ? Math.sin(-t * 2 + p.cx * 1.6) * Math.cos(-t + p.cy) * 0.006 * p.rand : 0
      let ox = this.dir[i * 3] * di
      let oy = this.dir[i * 3 + 1] * di
      let oz = this.dir[i * 3 + 2] * di + breath - (1 - introE) * 0.9
      ox += ee * (p.cx * 0.35 + (p.rand - 0.5) * 1.5)
      oy += ee * (1.2 + p.rand * 2.4) * dirSign
      oz += ee * (2.0 + p.rand * 3.0)
      const glow = smooth(0.0, 0.2, di) + ee * 0.12
      glowSum += smooth(0.0, 0.2, di)
      sd.set([ox, oy, oz, glow], i * 4)
      // rotação: proporcional ao deslocamento, fase própria por eixo
      const k = di * 0.9 + ee * (2 + p.rand * 3) + (1 - introE) * 0.6
      const ax = Math.cos(this.phase[i * 3] + t * 0.3) * k
      const ay = Math.cos(this.phase[i * 3 + 1] + t * 0.25) * k
      const az = Math.cos(this.phase[i * 3 + 2]) * k * 0.4
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ax, ay, az))
      sd.set([q.x, q.y, q.z, q.w], (N + i) * 4)
      sd[(2 * N + i) * 4] = intro
    }
    this.state.needsUpdate = true

    const sh = (this.mesh.material as THREE.MeshPhysicalMaterial).userData.shader
    if (sh) sh.uniforms.uTime.value = t
    this.core.material.uniforms.uMouse.value.copy(this.mouse)
    this.core.material.uniforms.uI.value += ((hov > 0 ? clamp(glowSum / 6) : 0) - this.core.material.uniforms.uI.value) * damp(0.08, dt)
    this.core.material.uniforms.uTime.value = t
    this.core.visible = it > 2.5

    // abertura: traço, luz, poeira
    const op = it < 0 ? 0 : clamp(it / 1.6)
    this.outline.material.uniforms.uP.value = ease(op)
    this.outline.material.uniforms.uFade.value = it < 0 ? 0 : 1 - smooth(2.4, 3.6, it)
    this.outline.visible = it >= 0 && it < 3.7
    const lightOn = it < 0 ? 0 : smooth(0.4, 3.5, it)
    this.wall.material.uniforms.uLight.value.copy(this.light)
    this.wall.material.uniforms.uI.value = lightOn
    this.dust.material.uniforms.uLight.value.copy(this.light)
    this.dust.material.uniforms.uI.value = lightOn
    this.dust.material.uniforms.uTime.value = t

    // câmera: paralaxe leve do cursor, tremor mínimo, e desce ao sair
    const mx = f.pointer.inside ? f.pointer.x : 0
    const my = f.pointer.inside ? f.pointer.y : 0
    const cx = mx * 0.32 + Math.sin(t * 0.5) * 0.02
    const cy = my * 0.16 + Math.cos(t * 0.43) * 0.015 - exit * 0.6 * dirSign
    this.cam.position.x += (cx - this.cam.position.x) * damp(0.05, dt)
    this.cam.position.y += (cy - this.cam.position.y) * damp(0.05, dt)
    this.cam.position.z = 9 - exit * 1.4 + (it >= 0 ? (1 - ease(clamp(it / 5))) * 2.5 : 0)
    this.cam.lookAt(0, -exit * 0.3 * dirSign, 0)

    // som: o zumbido sobe com a luz de dentro
    f.sound.setDyn('marca', 0.6 + clamp(glowSum / 8) * 0.8)

    // textos
    const on = it > 3.4 && exit < 0.12 && f.vis > 0.5
    this.setLabels(on)
    const L = this.labels
    const a = f.vis
    L.lead.alpha = a
    L.side.alpha = a
    L.mani.alpha = a
    L.hint.alpha = a * 0.7
    const narrow = this.w < 760
    const m = narrow ? 24 : 48
    L.lead.place(m, 116)
    L.side.place(m, this.h - 120)
    if (narrow) {
      if (L.mani.o.maxWidth !== this.w - 48) {
        L.mani.o.maxWidth = this.w - 48
        L.mani.layout()
      }
      L.mani.place(m, this.h * 0.7)
    } else L.mani.place(Math.max(this.w * 0.5 + 220, this.w - 48 - 280), this.h * 0.36)
    L.hint.place(this.w / 2, this.h - (narrow ? 84 : 44))

    this.plexus(f, hov)
  }

  plexus(f: Frame, hov: number) {
    const dt = f.dt
    // até 5 peças mais deslocadas perto do cursor
    const cand: number[] = []
    for (let i = 0; i < this.n; i++) if (this.disp[i] > 0.05) cand.push(i)
    cand.sort((a, b) => this.disp[b] - this.disp[a])
    const sel = hov > 0.5 ? cand.slice(0, 5) : []
    // ligações desejadas: cada um com até 2 vizinhos mais próximos
    const want = new Set<string>()
    for (const a of sel) {
      const near = sel
        .filter((b) => b !== a)
        .sort((x, y) => this.d2(a, x) - this.d2(a, y))
        .slice(0, 2)
      for (const b of near) want.add(a < b ? `${a}-${b}` : `${b}-${a}`)
    }
    // uma mudança por vez
    this.queueT -= dt
    if (this.queueT <= 0) {
      let changed = false
      for (const [k, l] of this.links)
        if (!want.has(k) && l.dir > 0) {
          l.dir = -1
          changed = true
          this.queueT = 0.06
          break
        }
      if (!changed)
        for (const k of want)
          if (!this.links.has(k) || this.links.get(k)!.dir < 0) {
            const [a, b] = k.split('-').map(Number)
            const ex = this.links.get(k)
            if (ex) ex.dir = 1
            else this.links.set(k, { a, b, p: 0, dir: 1 })
            this.queueT = 0.1
            if (f.t - this.lastStone > 0.14) {
              f.sound.stone(0.35)
              this.lastStone = f.t
            }
            break
          }
    }
    const lines = f.ov.lines
    const pts = new Map<number, { x: number; y: number }>()
    const scr = (i: number) => {
      if (!pts.has(i)) {
        const p = this.pieces[i]
        const o = this.stateData
        const v = new THREE.Vector3(p.cx + o[i * 4], p.cy + o[i * 4 + 1], this.depth / 2 + o[i * 4 + 2]).multiplyScalar(this.group.scale.x)
        const s = toScreen(v, this.cam, this.w, this.h)
        pts.set(i, { x: s.x, y: s.y })
      }
      return pts.get(i)!
    }
    for (const [k, l] of this.links) {
      l.p = clamp(l.p + (l.dir > 0 ? dt / 0.1 : -dt / 0.06))
      if (l.p <= 0 && l.dir < 0) {
        this.links.delete(k)
        continue
      }
      const A = scr(l.a)
      const B = scr(l.b)
      lines.seg(A.x, A.y, A.x + (B.x - A.x) * l.p, A.y + (B.y - A.y) * l.p, 0.55 * f.vis)
    }
    this.numLabels.forEach((lab, j) => {
      const i = sel[j]
      if (i === undefined) {
        lab.alpha += (0 - lab.alpha) * damp(0.3, dt)
        return
      }
      const s = scr(i)
      lab.set(pad(this.disp[i] * 100))
      if (lab.target === 0) lab.show(true)
      lab.alpha += (f.vis - lab.alpha) * damp(0.3, dt)
      lab.place(s.x + 7, s.y - 16)
      f.ov.dots.dot(s.x, s.y, 3, 0.9 * f.vis)
    })
  }

  d2(a: number, b: number) {
    const A = this.pieces[a]
    const B = this.pieces[b]
    return (A.cx - B.cx) ** 2 + (A.cy - B.cy) ** 2
  }

  render(r: THREE.WebGLRenderer) {
    r.setRenderTarget(this.rt)
    r.render(this.scene, this.cam)
  }
}
