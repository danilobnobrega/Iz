import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { Section, damp, ease, fit, type Ctx, type Rect } from '../y/core'
import { FX } from './fx'

// 18h, 192 metros acima de Goiânia. Céu físico (espalhamento de Rayleigh e Mie) com o sol
// descendo conforme se rola. Lá embaixo, quatro mil prédios: as janelas acendem uma a uma, as
// ruas ganham luz de sódio, e faróis correm pelas avenidas. Em primeiro plano, o guarda-corpo
// de vidro do terraço.

const CITY_VERT = /* glsl */ `
  varying vec3 vW; varying vec3 vN; varying float vId; varying vec3 vLocal; varying vec3 vScale;
  void main(){
    vId = float(gl_InstanceID);
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vLocal = position;
    vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    gl_Position = projectionMatrix * viewMatrix * w;
  }`
const CITY_FRAG = /* glsl */ `
  uniform vec3 uSun, uSunCol, uSkyCol, uFog, uFogSun, uHor; uniform float uLit, uTime, uFogD;
  varying vec3 vW; varying vec3 vN; varying float vId; varying vec3 vLocal; varying vec3 vScale;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  // neblina: mais quente (e clara) na direção do sol
  vec3 fogCol(vec3 v){
    vec2 a = normalize(v.xz), b = normalize(uSun.xz);
    return mix(uFog, uFogSun, pow(max(dot(a, b), 0.0), 6.0));
  }
  void main(){
    vec3 n = normalize(vN);
    vec3 v = normalize(vW - cameraPosition);
    float bid = h(vec2(vId, 7.1));
    float glassy = step(0.62, bid);
    float tone = h(vec2(vId, 3.3));
    vec3 base = mix(vec3(0.02, 0.021, 0.025), vec3(0.06, 0.05, 0.042), tone * tone);
    float sunL = max(dot(n, uSun), 0.0);
    vec3 col = base * (uSkyCol * (0.25 + 0.75 * max(n.y, 0.0)) + uSunCol * sunL * 1.4);
    // torres de vidro: refletem o céu (horizonte embaixo, céu em cima), mais forte de raspão
    float fr = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
    vec3 r = reflect(v, n);
    vec3 refl = mix(uHor, uSkyCol, clamp(r.y * 4.0, 0.0, 1.0)) + uSunCol * pow(max(dot(r, uSun), 0.0), 60.0) * 3.0;
    col = mix(col, refl * 0.55, glassy * (0.25 + fr * 0.6) * step(abs(n.y), 0.5));
    if (abs(n.y) < 0.5) {
      float u = abs(n.x) > 0.5 ? vLocal.z * vScale.z : vLocal.x * vScale.x;
      float y = vLocal.y * vScale.y;
      // vidro: faixas de janela contínuas; concreto: janelas isoladas
      vec2 cs = mix(vec2(2.8, 3.1), vec2(1.6, 3.1), glassy);
      vec2 cell = floor(vec2(u, y) / cs);
      vec2 f = fract(vec2(u, y) / cs);
      vec2 fw = fwidth(vec2(u, y) / cs);
      vec2 lo = mix(vec2(0.28, 0.32), vec2(0.04, 0.3), glassy), hi = mix(vec2(0.72, 0.78), vec2(0.96, 0.82), glassy);
      vec2 e = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
      float win = e.x * e.y;
      float area = (hi.x - lo.x) * (hi.y - lo.y);
      // cada apartamento acende na sua hora; prédios "comerciais" acendem antes
      float rate = uLit * mix(0.3 + bid * 0.55, 0.28, glassy);
      // no vidro, acende por andar e por trecho de escritório (6 vãos), não janela a janela
      vec2 unit = mix(cell, vec2(floor(cell.x / 6.0), cell.y), glassy);
      float rr = h(unit + vec2(bid * 91.0, n.x * 3.0 + n.z * 7.0));
      float on = smoothstep(rr - 0.02, rr + 0.02, rate);
      float warmK = step(0.8, h(cell * 1.3 + bid));
      vec3 warm = mix(vec3(1.0, 0.6, 0.26), vec3(0.8, 0.88, 1.0), max(warmK, glassy * 0.7)) * (0.5 + 0.6 * h(unit + 0.5)) * mix(1.0, 0.55, glassy);
      // longe (janela menor que um pixel) vira a média: sem chuvisco
      float far = smoothstep(0.25, 0.6, max(fw.x, fw.y));
      vec3 lit = mix(warm * win * on, vec3(1.0, 0.66, 0.34) * area * rate * mix(0.6, 0.3, glassy), far);
      col = mix(col, col * 0.6, win * (1.0 - far) * 0.6);
      // o térreo mais iluminado (lojas), acende cedo
      float shop = smoothstep(4.2, 3.0, y) * step(0.5, h(vec2(vId, 1.7)));
      col += lit * 1.3 + vec3(1.0, 0.7, 0.4) * shop * smoothstep(0.0, 0.3, uLit) * 0.18 * step(20.0, vScale.y);
    } else {
      // laje: caixas d'água e máquinas, um pouco de ruído
      col *= 0.8 + 0.4 * h(floor(vW.xz * 0.3));
      // luz vermelha de balizamento nas torres altas, piscando
      float tall = step(110.0, vScale.y);
      float c = length(vLocal.xz * vScale.xz);
      col += vec3(1.0, 0.08, 0.04) * tall * smoothstep(1.6, 0.6, c) * step(0.5, fract(uTime * 0.5 + bid)) * 4.0 * smoothstep(0.1, 0.4, uLit);
    }
    float d = length(vW - cameraPosition);
    float fog = 1.0 - exp(-d * uFogD);
    col = mix(col, fogCol(v), fog);
    gl_FragColor = vec4(col, 1.0);
  }`

// o chão: a malha de ruas (as mesmas avenidas entre as quadras) acendendo em sódio
const GROUND_FRAG = /* glsl */ `
  uniform vec3 uSun, uFog, uFogSun; uniform float uOn, uFogD; uniform vec2 uC, uAv[6];
  varying vec3 vW;
  vec3 fogCol(vec3 v){
    vec2 a = normalize(v.xz), b = normalize(uSun.xz);
    return mix(uFog, uFogSun, pow(max(dot(a, b), 0.0), 6.0));
  }
  void main(){
    vec2 q = vec2(vW.x - 45.0, vW.z + 135.0) / 90.0;
    vec2 dd = abs(fract(q + 0.5) - 0.5) * 90.0;
    float dm = min(dd.x, dd.y);
    // as radiais do traçado de Goiânia, saindo da praça
    float da = 1e5;
    for (int i = 0; i < 6; i++) { vec2 rel = vW.xz - uC; da = min(da, abs(rel.x * uAv[i].y - rel.y * uAv[i].x)); }
    float fw = fwidth(dm) + 0.001;
    float fa = fwidth(da) + 0.001;
    float far = smoothstep(1.0, 5.0, fw);
    // ruas: fio de sódio fino; longe, a média
    // cada rua tem seu brilho (umas mais movimentadas, outras quase apagadas)
    vec2 id = floor(q + 0.5);
    float sx = fract(sin(id.x * 12.9898) * 43758.5), sz = fract(sin(id.y * 78.233) * 43758.5);
    float sk = dd.x < dd.y ? sx : sz;
    float glow = mix(exp(-dm * 0.6) * (0.15 + sk * sk * 1.1), 0.03, far);
    float glowA = mix(exp(-da * 0.22), 0.08 * smoothstep(40.0, 0.0, da / max(fa, 1.0)), smoothstep(1.0, 5.0, fa));
    vec3 col = vec3(0.01, 0.01, 0.012);
    col += vec3(1.0, 0.45, 0.12) * glow * uOn * 0.3;
    col += vec3(1.0, 0.62, 0.3) * glowA * uOn * 0.45;
    vec3 v = normalize(vW - cameraPosition);
    float d = length(vW - cameraPosition);
    col = mix(col, fogCol(v), 1.0 - exp(-d * uFogD));
    gl_FragColor = vec4(col, 1.0);
  }`

// o traçado de 1933: avenidas radiais que partem de um centro (a Praça Cívica), à frente do terraço
const AV_C = new THREE.Vector2(-150, -2100)
const AV = [-64, -38, -14, 9, 33, 58].map((a) => new THREE.Vector2(Math.sin(THREE.MathUtils.degToRad(a)), Math.cos(THREE.MathUtils.degToRad(a))))
const avDist = (x: number, z: number) => Math.min(...AV.map((d) => Math.abs((x - AV_C.x) * d.y - (z - AV_C.y) * d.x)))

export class DuskSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(36, 1, 0.1, 20000)
  fx = new FX()
  sky = new Sky()
  city!: THREE.InstancedMesh<THREE.BoxGeometry, THREE.ShaderMaterial>
  lights!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  cars!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  sun = new THREE.Vector3()
  look = new THREE.Vector2()
  hemi = new THREE.HemisphereLight('#9fb3d9', '#2a1c14', 0.6)
  key = new THREE.DirectionalLight('#ffb070', 2)
  groundMat!: THREE.ShaderMaterial
  dome!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>

  constructor(el: HTMLElement) {
    super(el)
    this.sky.scale.setScalar(15000)
    const su = this.sky.material.uniforms
    su.turbidity.value = 6
    su.rayleigh.value = 2.2
    su.mieCoefficient.value = 0.006
    su.mieDirectionalG.value = 0.88
    this.scene.add(this.sky)
    // a hora azul: o céu físico fica cinza-marrom depois que o sol some; por cima, um degradê azul
    // profundo que entra com a rolagem (o brilho quente perto do horizonte continua do céu físico)
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(14000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        uniforms: { uK: { value: 0 } },
        vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uK; varying vec3 vD;
          void main(){
            float y = vD.y;
            vec3 top = vec3(0.008, 0.016, 0.045), mid = vec3(0.03, 0.05, 0.11);
            vec3 c = mix(mid, top, smoothstep(0.02, 0.5, y));
            float a = smoothstep(0.25, 1.0, uK) * smoothstep(0.0, 0.25, y) * 0.9;
            gl_FragColor = vec4(c, a);
          }`,
      }),
    )
    this.dome.frustumCulled = false
    this.scene.add(this.dome)

    // cidade: grade de quadras com prédios de alturas variadas
    const N = 4200
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.translate(0, 0.5, 0)
    const mat = new THREE.ShaderMaterial({
      vertexShader: CITY_VERT,
      fragmentShader: CITY_FRAG,
      uniforms: {
        uSun: { value: new THREE.Vector3() },
        uSunCol: { value: new THREE.Color() },
        uSkyCol: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uFogSun: { value: new THREE.Color() },
        uHor: { value: new THREE.Color() },
        uLit: { value: 0 },
        uTime: { value: 0 },
        uFogD: { value: 0.00045 },
      },
    })
    this.city = new THREE.InstancedMesh(geo, mat, N)
    const m = new THREE.Matrix4()
    const R = () => Math.random()
    let k = 0
    const block = 90
    for (let gx = -30; gx <= 30 && k < N; gx++)
      for (let gz = -40; gz <= -1 && k < N; gz++) {
        const cx = gx * block, cz = gz * block - 180
        const dist = Math.hypot(cx, cz)
        if (dist < 240 || dist > 3600) continue
        const nb = 1 + Math.floor(R() * 4)
        for (let b = 0; b < nb && k < N; b++) {
          // Goiânia: torres residenciais esguias no meio de casas e prédios baixos
          // perto do terraço só casas e prédios baixos (as torres começam a 650 m)
          const tower = dist > 650 && R() < 0.45
          const w = tower ? 16 + R() * 12 : 14 + R() * 30, d = tower ? 16 + R() * 12 : 14 + R() * 30
          const hgt = tower ? 45 + Math.pow(R(), 1.6) * 110 : dist < 650 ? 4 + Math.pow(R(), 2) * 14 : 6 + R() * 22
          const bx = cx + (R() - 0.5) * (block - w - 14), bz = cz + (R() - 0.5) * (block - d - 14)
          if (avDist(bx, bz) < Math.max(w, d) * 0.75 + 16) continue
          m.compose(new THREE.Vector3(bx, -192, bz), new THREE.Quaternion(), new THREE.Vector3(w, hgt, d))
          this.city.setMatrixAt(k++, m)
        }
      }
    this.city.count = k
    this.city.frustumCulled = false
    this.scene.add(this.city)

    // chão escuro
    const cu0 = mat.uniforms
    this.groundMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: GROUND_FRAG,
      uniforms: { uSun: cu0.uSun, uFog: cu0.uFog, uFogSun: cu0.uFogSun, uFogD: cu0.uFogD, uOn: { value: 0 }, uC: { value: AV_C }, uAv: { value: AV } },
    })
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), this.groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -192.2
    this.scene.add(ground)

    // luz de rua (sódio) ao longo das avenidas, e faróis
    const sl: number[] = []
    for (let gx = -30; gx <= 30; gx++) for (let s = 0; s < 70; s++) sl.push(gx * 90 + 45, -191, -s * 50 - 200)
    for (let gz = -40; gz <= -1; gz++) for (let s = -60; s < 60; s++) sl.push(s * 50, -191, gz * 90 - 180 + 45)
    for (const dv of AV) for (let t = -4200; t < 4200; t += 26) for (const sd of [-11, 11]) {
      const x = AV_C.x + dv.x * t + dv.y * sd, z = AV_C.y + dv.y * t - dv.x * sd
      if (z < -150 && Math.abs(x) < 6000 && Math.abs(t) > 160) sl.push(x, -190, z)
    }
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.Float32BufferAttribute(sl, 3))
    pg.setAttribute('aR', new THREE.Float32BufferAttribute(sl.map(() => Math.random()).filter((_, i) => i % 3 === 0), 1))
    this.lights = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uOn: { value: 0 }, uDpr: { value: 1 } },
        vertexShader: `attribute float aR; uniform float uOn, uDpr; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vA = step(aR, uOn); gl_PointSize = max(1.2, 900.0 / -mv.z) * uDpr; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * smoothstep(0.5, 0.0, d) * vA * 3.0, 1.0); }`,
      }),
    )
    this.lights.frustumCulled = false
    this.scene.add(this.lights)
    // faróis: andam pelas avenidas (vermelho indo, branco vindo)
    const NC = 1400
    const cp = new Float32Array(NC * 3)
    const cs = new Float32Array(NC * 3)
    for (let i = 0; i < NC; i++) {
      const vertical = Math.random() < 0.5
      const lane = vertical ? Math.floor(Math.random() * 61) - 30 : -Math.floor(Math.random() * 40) - 1
      cs.set([vertical ? 1 : 0, lane, Math.random()], i * 3)
    }
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3))
    cg.setAttribute('aS', new THREE.BufferAttribute(cs, 3))
    this.cars = new THREE.Points(
      cg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uDpr: { value: 1 } },
        vertexShader: /* glsl */ `attribute vec3 aS; uniform float uTime, uOn, uDpr; varying vec3 vC;
          void main(){
            float dir = fract(aS.z * 7.0) > 0.5 ? 1.0 : -1.0;
            float t = fract(aS.z + uTime * 0.012 * dir * (0.6 + fract(aS.z * 13.0)));
            vec3 p;
            if (aS.x > 0.5) p = vec3(aS.y * 90.0 + 45.0 + dir * 4.0, -191.2, -200.0 - t * 3500.0);
            else p = vec3((t - 0.5) * 6000.0, -191.2, aS.y * 90.0 - 135.0 + dir * 4.0);
            vC = dir > 0.0 ? vec3(1.0, 0.12, 0.08) : vec3(1.0, 0.92, 0.8);
            vC *= uOn;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = max(1.0, 700.0 / -mv.z) * uDpr;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC * smoothstep(0.5, 0.0, d) * 2.5, 1.0); }`,
      }),
    )
    this.cars.frustumCulled = false
    this.scene.add(this.cars)

    this.scene.add(this.hemi, this.key)
    this.fx.threshold = 1.2
    this.fx.final.uniforms.uBloom.value = 0.55
    this.fx.final.uniforms.uCA.value *= 0.3
  }

  // tabela medida do próprio céu: para 24 alturas do sol, a cor do horizonte na direção do sol,
  // a oposta e o céu a 35° (luz ambiente). A neblina e os reflexos vêm daí, não de chute.
  table: { sun: THREE.Color; away: THREE.Color; up: THREE.Color }[] = []
  sunAt(k: number, out: THREE.Vector3) {
    const elev = THREE.MathUtils.degToRad(5 - k * 10)
    return out.setFromSphericalCoords(1, Math.PI / 2 - elev, THREE.MathUtils.degToRad(-30) + Math.PI)
  }
  async init(r: THREE.WebGLRenderer) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType })
    const cam = new THREE.PerspectiveCamera(1, 1, 1, 20000)
    const sc = new THREE.Scene()
    sc.add(this.sky)
    const px = new Float32Array(4)
    const sun = new THREE.Vector3()
    const read = (dir: THREE.Vector3) => {
      cam.lookAt(dir)
      r.setRenderTarget(rt)
      r.render(sc, cam)
      r.readRenderTargetPixels(rt, 0, 0, 1, 1, px)
      return new THREE.Color(px[0], px[1], px[2])
    }
    for (let i = 0; i < 24; i++) {
      this.sunAt(i / 23, sun)
      this.sky.material.uniforms.sunPosition.value.copy(sun)
      const flat = new THREE.Vector3(sun.x, 0, sun.z).normalize()
      const e = Math.tan(THREE.MathUtils.degToRad(1.2))
      this.table.push({
        sun: read(flat.clone().setY(e)),
        away: read(flat.clone().negate().setY(e)),
        up: read(flat.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).setY(0.7)),
      })
    }
    r.setRenderTarget(null)
    rt.dispose()
    this.scene.add(this.sky)
  }
  sample(k: number, key: 'sun' | 'away' | 'up', out: THREE.Color) {
    if (!this.table.length) return out.setRGB(0.5, 0.5, 0.5)
    const f = THREE.MathUtils.clamp(k, 0, 1) * 23
    const i = Math.min(22, Math.floor(f))
    return out.lerpColors(this.table[i][key], this.table[i + 1][key], f - i)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 66 : 46
    this.cam.updateProjectionMatrix()
    this.fx.resize(w, h, dpr)
    this.lights.material.uniforms.uDpr.value = dpr
    this.cars.material.uniforms.uDpr.value = dpr
  }

  update(p: number, c: Ctx, rect: Rect) {
    // o sol desce de 5° a −5°: dourado, depois a hora azul
    const k = ease(fit(p, 0.0, 0.85))
    const elev = THREE.MathUtils.degToRad(5 - k * 10)
    const az = THREE.MathUtils.degToRad(-30)
    this.sun.setFromSphericalCoords(1, Math.PI / 2 - elev, az + Math.PI)
    const su = this.sky.material.uniforms
    su.sunPosition.value.copy(this.sun)
    // cores: pôr do sol quente, depois azul
    // cores em HDR, na mesma escala do céu físico (a exposição sobe enquanto o céu escurece)
    const L = THREE.MathUtils.lerp
    const sunCol = new THREE.Color(1.0, 0.5, 0.22).multiplyScalar(L(2.2, 0, Math.min(1, k * 1.25)))
    // a luz que vem do céu nas fachadas é bem menor que o céu (só uma parte do hemisfério)
    const skyCol = this.sample(k, 'up', new THREE.Color()).multiplyScalar(0.55)
    const fogCol = this.sample(k, 'away', new THREE.Color())
    const fogSun = this.sample(k, 'sun', new THREE.Color())
    const cu = this.city.material.uniforms
    cu.uSun.value.copy(this.sun)
    cu.uSunCol.value.copy(sunCol)
    cu.uSkyCol.value.copy(skyCol)
    cu.uFog.value.copy(fogCol)
    cu.uFogSun.value.copy(fogSun)
    cu.uHor.value.copy(fogCol)
    this.groundMat.uniforms.uOn.value = ease(fit(p, 0.1, 0.7))
    cu.uLit.value = 0.04 + ease(fit(p, 0.08, 0.9)) * 0.8
    cu.uTime.value = c.t
    this.lights.material.uniforms.uOn.value = fit(p, 0.12, 0.6)
    this.cars.material.uniforms.uTime.value = c.t
    this.cars.material.uniforms.uOn.value = 0.4 + fit(p, 0.2, 0.7) * 0.6
    this.key.color.copy(sunCol)
    this.key.position.copy(this.sun).multiplyScalar(100)
    this.key.intensity = 2.5 * Math.max(0, 1 - k)
    this.hemi.intensity = 0.25 + (1 - k) * 0.4
    this.fx.final.uniforms.uExposure.value = 0.2 + k * 1.2
    this.dome.material.uniforms.uK.value = k
    this.fx.final.uniforms.uFade.value = 1
    // câmera: no terraço, olhando o horizonte; o cursor vira a cabeça
    const m = this.local(c, rect)
    this.look.x += ((m.inside ? m.x : 0) - this.look.x) * damp(0.04, c.dt)
    this.look.y += ((m.inside ? m.y : 0) - this.look.y) * damp(0.04, c.dt)
    const yaw = -0.08 + p * 0.22 + this.look.x * 0.18
    const pitch = 0.035 + this.look.y * 0.06 - p * 0.05
    this.cam.position.set(Math.sin(c.t * 0.07) * 0.1, 0, 0.6 - p * 0.8)
    this.cam.lookAt(this.cam.position.x + Math.sin(yaw) * 10, Math.sin(pitch) * 10, this.cam.position.z - Math.cos(yaw) * 10)
  }

  render(c: Ctx, rect: Rect) {
    this.fx.render(c, rect, this.scene, this.cam)
  }
}
