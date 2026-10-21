import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import type { Frame, Place } from './engine'
import { quad, rt } from './post'
import { FONTS, Label, type Overlay } from './type'
import { HOUSES } from './houses'
import { clamp, damp, ease, easeInOut, fit, rng, smooth } from './util'

// Lugares 3 e 4 — o poço e o contato, feitos do mesmo pó: os pontos gravados nos vidros soltos
// no ar. Primeiro eles descem em espiral por um poço, com três anéis; a câmera desce olhando para
// baixo e gira. No fundo, o pó se junta no nome de cada casa, em volume, sobre um pedestal.
// O cursor sopra o pó; trocar de casa espalha tudo e reorganiza no nome seguinte.

const SIM = /* glsl */ `
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  vec3 curl(vec3 p){
    const float e = 0.1;
    vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
    vec3 a = vec3(snoise(p), snoise(p + 31.7), snoise(p + 71.3));
    float x1 = snoise(p + 31.7 + dy) - snoise(p + 31.7 - dy);
    float x2 = snoise(p + 71.3 + dz) - snoise(p + 71.3 - dz);
    float y1 = snoise(p + 71.3 + dx) - snoise(p + 71.3 - dx);
    float y2 = snoise(p + dz) - snoise(p - dz);
    float z1 = snoise(p + dx) - snoise(p - dx);
    float z2 = snoise(p + 31.7 + dx) - snoise(p + 31.7 - dx);
    return vec3(x1 - x2, y1 - y2, z1 - z2) / (2.0 * e) + a * 0.0;
  }
  // o poço: três fios em espiral que descem, e três anéis
  vec3 helix(vec4 s, float t){
    if (s.w < 0.3) {
      float k = floor(s.w / 0.1);
      float y = 6.0 - k * 4.0;
      float a = s.x * 6.2831853 + t * 0.06 * (mod(k, 2.0) < 0.5 ? 1.0 : -1.0);
      float r = 2.35 + (s.y - 0.5) * 0.22 + sin(a * 9.0 + k) * 0.05;
      return vec3(cos(a) * r, y + (s.z - 0.5) * 0.12, sin(a) * r);
    }
    float f = fract(s.x + t * 0.012);
    float y = 9.0 - f * 21.0;
    float strand = floor(s.y * 3.0);
    float a = f * 22.0 + strand * 2.0943951 + t * 0.05;
    float r = 0.85 + (s.z - 0.5) * 0.45 + sin(f * 40.0 + strand) * 0.08;
    vec3 off = vec3(snoise(vec3(s.xyz * 9.0)), snoise(vec3(s.zxy * 9.0)), snoise(vec3(s.yzx * 9.0))) * 0.12;
    return vec3(cos(a) * r, y, sin(a) * r) + off;
  }
`

const VEL = /* glsl */ `
  uniform sampler2D tSeed, tA, tB;
  uniform float uMix, uHelix, uTime, uDt, uBurst, uMouseOn, uK;
  uniform vec3 uRayO, uRayD, uMouseVel;
  ${SIM}
  void main(){
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 p = texture2D(tPos, uv).xyz;
    vec3 v = texture2D(tVel, uv).xyz;
    vec4 s = texture2D(tSeed, uv);
    float w = clamp(uMix * 1.6 - s.x * 0.6, 0.0, 1.0); w = w * w * (3.0 - 2.0 * w);
    vec3 shapeT = mix(texture2D(tA, uv).xyz, texture2D(tB, uv).xyz, w);
    vec3 target = mix(shapeT, helix(s, uTime), uHelix);
    vec3 acc = (target - p) * uK;
    acc += curl(p * 0.45 + vec3(0.0, uTime * 0.04, 0.0)) * (0.35 + uBurst * 16.0);
    vec3 m = p - uRayO;
    vec3 perp = m - uRayD * dot(m, uRayD);
    float d = length(perp);
    float fall = smoothstep(0.7, 0.0, d) * uMouseOn;
    acc += normalize(perp + 1e-4) * fall * 9.0 + uMouseVel * fall * 2.2;
    v += acc * uDt;
    v *= pow(0.025, uDt);
    gl_FragColor = vec4(v, 1.0);
  }
`
const POS = /* glsl */ `
  uniform float uDt;
  void main(){
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 p = texture2D(tPos, uv);
    vec3 v = texture2D(tVel, uv).xyz;
    gl_FragColor = vec4(p.xyz + v * uDt, p.w);
  }
`

const FLOOR_Y = -10.45
const SHAPE_Y = -9.0

export class Po implements Place {
  name = 'po'
  length = 2.8
  stops = [2.62]
  rtScene = rt(2, 2, 4)
  rt = rt(2, 2)
  bloom = 0.85
  bloomStrength = 0.7
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(26, 1, 0.05, 200)
  gpu: GPUComputationRenderer
  vPos: Variable
  vVel: Variable
  S: number
  targets: THREE.DataTexture[] = []
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  floor: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  post: THREE.ShaderMaterial
  cur = 0
  from = 0
  mix = 1
  burst = 0
  floorRot = 0
  floorTarget = 0
  w = 1
  h = 1
  ray = new THREE.Raycaster()
  mouseO = new THREE.Vector3()
  mouseD = new THREE.Vector3(0, 0, -1)
  mouseVel = new THREE.Vector3()
  lastMouse = new THREE.Vector3()
  pulse = 0
  lastCamY = 99
  L: { name: Label; prev: Label; next: Label; go: Label; people: Label; head: Label }
  uiOn = false
  hoverGo = false
  armA = 0
  armB = 0
  qDown = new THREE.Quaternion()
  qFront = new THREE.Quaternion()
  ready = false

  constructor(r: THREE.WebGLRenderer, ov: Overlay, small = false) {
    this.S = small ? 256 : 384
    const S = this.S
    this.scene.background = new THREE.Color(0x060504)
    this.scene.fog = new THREE.Fog(0x060504, 14, 34)

    this.gpu = new GPUComputationRenderer(S, S, r)
    const pos0 = this.gpu.createTexture()
    const vel0 = this.gpu.createTexture()
    const seed = new Float32Array(S * S * 4)
    const R = rng(5)
    for (let i = 0; i < S * S; i++) {
      seed.set([R(), R(), R(), R()], i * 4)
      pos0.image.data!.set([(R() - 0.5) * 6, 10 - R() * 20, (R() - 0.5) * 6, R()], i * 4)
    }
    const seedTex = new THREE.DataTexture(seed, S, S, THREE.RGBAFormat, THREE.FloatType)
    seedTex.needsUpdate = true
    this.vPos = this.gpu.addVariable('tPos', POS, pos0)
    this.vVel = this.gpu.addVariable('tVel', VEL, vel0)
    this.gpu.setVariableDependencies(this.vVel, [this.vPos, this.vVel])
    this.gpu.setVariableDependencies(this.vPos, [this.vPos, this.vVel])
    const vu = this.vVel.material.uniforms
    Object.assign(vu, {
      tSeed: { value: seedTex },
      tA: { value: null },
      tB: { value: null },
      uMix: { value: 1 },
      uHelix: { value: 1 },
      uTime: { value: 0 },
      uDt: { value: 1 / 60 },
      uBurst: { value: 0 },
      uMouseOn: { value: 0 },
      uK: { value: 8 },
      uRayO: { value: new THREE.Vector3() },
      uRayD: { value: new THREE.Vector3(0, 0, -1) },
      uMouseVel: { value: new THREE.Vector3() },
    })
    this.vPos.material.uniforms.uDt = { value: 1 / 60 }
    const err = this.gpu.init()
    if (err) console.error('[v] gpgpu', err)

    // partículas desenhadas como pequenas esferas iluminadas
    const ref = new Float32Array(S * S * 2)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) ref.set([(x + 0.5) / S, (y + 0.5) / S], (y * S + x) * 2)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * S * 3), 3))
    g.setAttribute('aRef', new THREE.BufferAttribute(ref, 2))
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { tPos: { value: null }, tVel: { value: null }, uDpr: { value: 1 }, uSize: { value: 1 }, uFogNear: { value: 14 }, uFogFar: { value: 34 } },
        vertexShader: /* glsl */ `
          attribute vec2 aRef; uniform sampler2D tPos, tVel; uniform float uDpr, uSize;
          varying float vSpeed; varying float vR; varying float vDepth; varying float vNear;
          void main(){
            vec4 p = texture2D(tPos, aRef);
            vec3 v = texture2D(tVel, aRef).xyz;
            vSpeed = length(v);
            vR = p.w;
            vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
            vDepth = -mv.z;
            gl_PointSize = min((1.4 + p.w * 1.3) * uSize * (10.0 / -mv.z) * (1.0 + clamp(vSpeed * 0.04, 0.0, 0.6)), 7.0) * uDpr;
            // perto da lente, some (não vira bolha na cara da câmera)
            vNear = smoothstep(0.6, 2.2, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uFogNear, uFogFar;
          varying float vSpeed; varying float vR; varying float vDepth; varying float vNear;
          float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          void main(){
            vec2 c = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(c, c);
            if (r2 > 1.0 || hh(gl_FragCoord.xy) > vNear) discard;
            vec3 n = vec3(c.x, -c.y, sqrt(1.0 - r2));
            vec3 L = normalize(vec3(-0.5, 0.7, 0.55));
            float dif = max(dot(n, L), 0.0);
            float rim = pow(1.0 - n.z, 2.0);
            vec3 base = vec3(0.86, 0.8, 0.72) * (0.85 + vR * 0.3);
            vec3 col = base * (0.07 + dif * 0.75) + vec3(1.0, 0.75, 0.5) * rim * 0.12;
            col += vec3(1.0, 0.9, 0.78) * clamp(vSpeed * 0.06 - 0.1, 0.0, 1.0) * 0.9;
            float fogf = smoothstep(uFogNear, uFogFar, vDepth);
            col = mix(col, vec3(0.024, 0.02, 0.016), fogf);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    )
    this.points.frustumCulled = false
    this.scene.add(this.points)

    // pedestal: piso escuro polido com sulcos e um anel de luz
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 160),
      new THREE.ShaderMaterial({
        uniforms: { uRot: { value: 0 }, uTime: { value: 0 }, uLight: { value: 1 } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform float uRot, uTime, uLight; varying vec2 vP;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          void main(){
            float r = length(vP);
            float a = atan(vP.y, vP.x) + uRot;
            vec3 c = vec3(0.016, 0.014, 0.012) * (0.85 + 0.15 * h(floor(vP * 60.0)));
            // sulcos concêntricos
            float grooves = smoothstep(0.012, 0.0, abs(fract(r * 2.2) - 0.5) - 0.48);
            c += vec3(0.05, 0.045, 0.04) * grooves * smoothstep(6.5, 1.0, r);
            // marcas de graduação girando com o piso
            float ticks = step(0.92, fract(a / 6.2831853 * 120.0)) * smoothstep(0.03, 0.0, abs(r - 2.55));
            c += vec3(0.6, 0.5, 0.4) * ticks * 0.3;
            // anel de luz
            float ring = exp(-pow((r - 2.2) / 0.025, 2.0)) * 1.1 + exp(-pow((r - 2.2) / 0.35, 2.0)) * 0.06;
            c += vec3(1.0, 0.72, 0.45) * ring * uLight;
            // luz do pó sobre o piso
            c += vec3(1.0, 0.8, 0.6) * exp(-r * r * 0.35) * 0.05 * uLight;
            gl_FragColor = vec4(c * smoothstep(6.5, 4.5, r), 1.0);
          }`,
      }),
    )
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.y = FLOOR_Y
    this.scene.add(this.floor)

    // luz de fundo atrás do pedestal
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 24),
      new THREE.ShaderMaterial({
        depthWrite: false,
        uniforms: { uA: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform float uA; varying vec2 vUv;
          void main(){ vec2 p = (vUv - vec2(0.5, 0.42)) * vec2(40.0, 24.0);
            float g = exp(-dot(p * vec2(0.6, 1.0), p * vec2(0.6, 1.0)) * 0.02);
            gl_FragColor = vec4(vec3(1.0, 0.76, 0.52) * g * 0.05 * uA + vec3(0.006, 0.005, 0.004), 1.0); }`,
      }),
    )
    this.glow.position.set(0, SHAPE_Y + 1, -9)
    this.scene.add(this.glow)

    // pós próprio do poço: desfoque radial e um corte de blocos quando a câmera passa por um anel
    this.post = new THREE.ShaderMaterial({
      depthTest: false,
      uniforms: { tIn: { value: null }, uPulse: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tIn; uniform float uPulse, uTime; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 uv = vUv;
          // blocos deslocados (glitch curto), só no pico
          float g = step(0.8, uPulse);
          float row = floor(uv.y * 24.0);
          float shift = (h(vec2(row, floor(uTime * 30.0))) - 0.5) * 0.012 * g * step(0.85, h(vec2(row * 1.7, floor(uTime * 30.0))));
          uv.x += shift;
          vec2 c = uv - 0.5;
          vec3 col = vec3(0.0);
          float k = uPulse * 0.035;
          for (int i = 0; i < 10; i++) {
            float t = float(i) / 9.0;
            col += texture2D(tIn, 0.5 + c * (1.0 - k * t)).rgb;
          }
          col /= 10.0;
          col += vec3(1.0, 0.82, 0.62) * uPulse * 0.012;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })

    const o = { size: 10.5, spacing: 0.55, dur: 0.7 }
    this.L = {
      name: new Label(ov, '', { ...o, size: 11.5, align: 'center', dur: 0.6, spread: 0.8 }),
      prev: new Label(ov, '', { ...o, align: 'right', dur: 0.5 }),
      next: new Label(ov, '', { ...o, dur: 0.5 }),
      go: new Label(ov, '[ Como chegar ↗ ]', { ...o, align: 'center' }),
      people: new Label(ov, '// 445 pessoas trabalham no grupo hoje\n// 520 em 2026', { ...o, lineHeight: 1.6 }),
      head: new Label(ov, '/// As sete casas', { ...o }),
    }
  }

  // nomes das casas em volume (o pó se acomoda dentro das letras, mais grosso no meio dos traços)
  buildTargets() {
    const S = this.S
    const N = S * S
    const words = ['Íz', '1929', 'Grá', 'Alata', 'Fulles', 'Hotel', 'nip']
    const W = 640
    const H = 300
    const R = rng(9)
    for (const word of words) {
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const x = c.getContext('2d', { willReadFrequently: true })!
      x.fillStyle = '#000'
      x.fillRect(0, 0, W, H)
      x.fillStyle = '#fff'
      x.textAlign = 'center'
      x.textBaseline = 'alphabetic'
      let size = 230
      x.font = `${size}px ${FONTS.serif}`
      while (x.measureText(word).width > W * 0.9) {
        size -= 6
        x.font = `${size}px ${FONTS.serif}`
      }
      x.fillText(word, W / 2, H * 0.74)
      const mask = x.getImageData(0, 0, W, H).data
      // espessura: a máscara borrada dá o "meio" do traço
      const c2 = document.createElement('canvas')
      c2.width = W
      c2.height = H
      const x2 = c2.getContext('2d', { willReadFrequently: true })!
      x2.filter = 'blur(7px)'
      x2.drawImage(c, 0, 0)
      const thick = x2.getImageData(0, 0, W, H).data
      const inside: number[] = []
      for (let i = 0; i < W * H; i++) if (mask[i * 4] > 128) inside.push(i)
      const data = new Float32Array(N * 4)
      const sc = 5.0 / W
      for (let k = 0; k < N; k++) {
        const i = inside[Math.floor(R() * inside.length)]
        const px = (i % W) + R() - 0.5
        const py = Math.floor(i / W) + R() - 0.5
        const t = thick[i * 4] / 255
        const z = (R() - 0.5) * 2 * (0.08 + t * 0.42)
        data.set([(px - W / 2) * sc, SHAPE_Y + (H / 2 - py) * sc - 0.05, z, 1], k * 4)
      }
      const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.FloatType)
      tex.needsUpdate = true
      this.targets.push(tex)
    }
    const vu = this.vVel.material.uniforms
    vu.tA.value = this.targets[0]
    vu.tB.value = this.targets[0]
    this.ready = true
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    const W = Math.round(w * dpr)
    const H = Math.round(h * dpr)
    this.rtScene.setSize(W, H)
    this.rt.setSize(W, H)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
    this.points.material.uniforms.uDpr.value = dpr
    this.points.material.uniforms.uSize.value = Math.min(1.2, Math.max(0.8, h / 900))
  }

  hide() {
    this.showUI(false)
  }

  showUI(on: boolean) {
    if (on === this.uiOn) return
    this.uiOn = on
    const L = this.L
    L.name.show(on)
    L.prev.show(on, on ? 0.15 : 0)
    L.next.show(on, on ? 0.15 : 0)
    L.go.show(on, on ? 0.3 : 0)
    L.people.show(on, on ? 0.45 : 0)
    L.head.show(on, on ? 0.1 : 0)
  }

  setNames() {
    const n = HOUSES.length
    this.L.name.set(`${HOUSES[this.cur].name}`)
    this.L.prev.set(HOUSES[(this.cur + n - 1) % n].name)
    this.L.next.set(HOUSES[(this.cur + 1) % n].name)
  }

  switch(dir: number, f: Frame) {
    const n = HOUSES.length
    const vu = this.vVel.material.uniforms
    // fixa o alvo atual como ponto de partida
    vu.tA.value = this.targets[this.cur]
    this.cur = (this.cur + dir + n) % n
    vu.tB.value = this.targets[this.cur]
    this.mix = 0
    this.burst = 1
    this.floorTarget += dir * 4
    this.setNames()
    this.L.name.replay()
    this.L.prev.replay()
    this.L.next.replay()
    if (dir > 0) this.armB = 1
    else this.armA = 1
    f.sound.whoosh(0.8, 0.7, 1400, 300)
    f.sound.beep(0)
  }

  update(local: number, f: Frame) {
    const dt = f.dt
    const t = f.t
    if (!this.ready) return

    // câmera: desce olhando para baixo, girando; depois vira de frente para o pedestal
    const k = fit(local, -0.9, 2.0)
    const camY = 10.5 - easeInOut(k) * 15.5
    const a = k * Math.PI
    const downPos = new THREE.Vector3(0, camY, 0.0001)
    const m = new THREE.Matrix4().lookAt(downPos, new THREE.Vector3(0, camY - 10, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))
    this.qDown.setFromRotationMatrix(m)
    const mx = f.pointer.inside ? f.pointer.x : 0
    const my = f.pointer.inside ? f.pointer.y : 0
    const frontPos = new THREE.Vector3(mx * 0.5, SHAPE_Y + 0.35 + my * 0.25, 9.0 / Math.min(1, (this.w / this.h) * 1.5))
    const m2 = new THREE.Matrix4().lookAt(frontPos, new THREE.Vector3(0, SHAPE_Y - 0.35, 0), new THREE.Vector3(0, 1, 0))
    this.qFront.setFromRotationMatrix(m2)
    const sw = ease(fit(local, 1.85, 2.55))
    this.cam.position.lerpVectors(downPos, frontPos, sw)
    this.cam.position.y += Math.sin(sw * Math.PI) * -1.2
    this.cam.quaternion.slerpQuaternions(this.qDown, this.qFront, sw)
    this.cam.fov = 24 + k * 8 - sw * 4
    this.cam.updateProjectionMatrix()
    this.cam.updateMatrixWorld()

    // anéis: um pulso ao atravessar cada um
    let pulse = 0
    for (const ry of [6, 2, -2]) {
      pulse = Math.max(pulse, Math.exp(-Math.pow((camY - ry) / 0.55, 2)) * (1 - sw))
      if ((this.lastCamY - ry) * (camY - ry) < 0 && Math.abs(this.lastCamY - camY) < 2) f.sound.whoosh(0.7, 0.9, 200, 1600)
    }
    this.lastCamY = camY
    this.pulse = pulse
    f.sound.setDyn('passagem', clamp(1 - sw))

    // simulação
    const vu = this.vVel.material.uniforms
    this.mix = Math.min(1, this.mix + dt / 1.1)
    this.burst = Math.max(0, this.burst - dt / 0.5)
    vu.uMix.value = this.mix
    vu.uBurst.value = ease(this.burst)
    vu.uHelix.value = 1 - smooth(1.75, 2.35, local)
    vu.uTime.value = t
    vu.uDt.value = Math.min(dt, 1 / 30)
    vu.uK.value = 6 + sw * 4
    this.vPos.material.uniforms.uDt.value = Math.min(dt, 1 / 30)
    // cursor: raio do mouse e a velocidade dele no mundo
    if (f.pointer.inside) {
      this.ray.setFromCamera(new THREE.Vector2(f.pointer.x, f.pointer.y), this.cam)
      this.mouseO.copy(this.ray.ray.origin)
      this.mouseD.copy(this.ray.ray.direction)
      const pt = this.ray.ray.at(this.cam.position.distanceTo(new THREE.Vector3(0, SHAPE_Y, 0)), new THREE.Vector3())
      const v = pt.clone().sub(this.lastMouse).divideScalar(Math.max(dt, 1e-3))
      this.lastMouse.copy(pt)
      this.mouseVel.lerp(v.clampLength(0, 12), damp(0.3, dt))
    }
    vu.uRayO.value.copy(this.mouseO)
    vu.uRayD.value.copy(this.mouseD)
    vu.uMouseVel.value.copy(this.mouseVel)
    vu.uMouseOn.value += ((f.pointer.inside && f.pointer.moved < 1.5 ? 1 : 0) - vu.uMouseOn.value) * damp(0.1, dt)
    this.gpu.compute()
    this.points.material.uniforms.tPos.value = this.gpu.getCurrentRenderTarget(this.vPos).texture
    this.points.material.uniforms.tVel.value = this.gpu.getCurrentRenderTarget(this.vVel).texture
    f.sound.setDyn('contato', 0.5 + clamp(this.mouseVel.length() / 6) + this.burst)

    // piso
    this.floorRot += (this.floorTarget - this.floorRot) * damp(0.035, dt)
    this.floor.material.uniforms.uRot.value = this.floorRot
    this.floor.material.uniforms.uLight.value = 0.3 + sw * 0.7
    this.post.uniforms.uTime.value = t

    // interface do contato
    const on = local > 2.45 && local < 3.0 && f.vis > 0.6
    if (on && !this.uiOn) this.setNames()
    this.showUI(on)
    this.drawUI(f)
  }

  drawUI(f: Frame) {
    const L = this.L
    const a = f.vis
    Object.values(L).forEach((l) => (l.alpha = a))
    const cx = this.w / 2
    const by = this.h - 92
    L.name.place(cx, by - 8)
    const gap = Math.min(120, this.w * 0.24)
    L.prev.place(cx - gap, by - 8)
    L.next.place(cx + gap, by - 8)
    L.prev.alpha = a * 0.35
    L.next.alpha = a * 0.35
    L.go.place(cx, by + 28)
    const narrow = this.w < 760
    L.people.place(narrow ? 24 : 48, 116)
    L.head.place(this.w - 48 - L.head.width + 8, 116)
    if (narrow) L.head.alpha = 0
    const lines = f.ov.lines
    const p = f.pointer
    this.hoverGo = this.uiOn && p.px > L.go.x && p.px < L.go.x + L.go.width && p.py > L.go.y - 4 && p.py < L.go.y + L.go.height + 4
    if (L.name.p > 0.3) {
      // colchetes de mira em volta do nome
      const bw = Math.max(70, L.name.width / 2 + 18)
      const bh = 16
      const ca = a * 0.85
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
          const X = cx + sx * bw
          const Y = by + sy * bh
          lines.seg(X, Y, X - sx * 8, Y, ca)
          lines.seg(X, Y, X, Y - sy * 7, ca)
        }
      const uy = L.go.y + L.go.height - 3
      lines.seg(L.go.x + 4, uy, L.go.x + L.go.width - 4, uy, a * (this.hoverGo ? 0.9 : 0.3))
      // setas laterais, que piscam ao trocar
      this.armA = Math.max(0, this.armA - f.dt * 2.5)
      this.armB = Math.max(0, this.armB - f.dt * 2.5)
      const ay = this.h * 0.46
      const ax = this.w * 0.2
      const bx = this.w * 0.8
      const aa = a * (0.45 + this.armA * 0.55)
      const ba = a * (0.45 + this.armB * 0.55)
      lines.seg(ax, ay, ax + 52, ay, aa)
      lines.seg(ax, ay, ax + 9, ay - 6, aa)
      lines.seg(bx, ay, bx - 52, ay, ba)
      lines.seg(bx, ay, bx - 9, ay - 6, ba)
    }
  }

  hover() {
    return this.uiOn
  }

  click(f: Frame) {
    if (!this.uiOn) return false
    if (this.hoverGo) {
      window.open(HOUSES[this.cur].maps, '_blank', 'noopener')
      return true
    }
    this.switch(f.pointer.px < this.w / 2 ? -1 : 1, f)
    return true
  }

  key(k: string, f: Frame) {
    if (!this.uiOn) return false
    if (k === 'ArrowLeft') this.switch(-1, f)
    else if (k === 'ArrowRight') this.switch(1, f)
    else return false
    return true
  }

  render(r: THREE.WebGLRenderer) {
    r.setRenderTarget(this.rtScene)
    r.render(this.scene, this.cam)
    this.post.uniforms.tIn.value = this.rtScene.texture
    this.post.uniforms.uPulse.value = this.pulse
    quad.run(r, this.post, this.rt)
  }
}
