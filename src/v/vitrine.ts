import * as THREE from 'three'
import type { Frame, Place } from './engine'
import { Cut, rt } from './post'
import { Label, toScreen, type Overlay } from './type'
import { HOUSES, type House } from './houses'
import { shapeFor } from './shapes'
import { engrave, type Cloud } from './engrave'
import { clamp, damp, ease, goianiaClock, pad, rng, smooth } from './util'
import { Casa } from './casa'

// Lugar 2 — a vitrine. Cada casa é um bloco de vidro fundido de formato próprio, com uma foto da
// casa gravada a laser por dentro (nuvem de microfraturas com relevo). O vidro é desenhado em três
// passadas: o fundo e as gravações; a profundidade das faces de trás (espessura real em cada pixel);
// e a face da frente, que refrata o fundo pela espessura, com dispersão, absorção verde de vidro
// grosso e reflexo de estúdio. Passar o mouse embaça o vidro como um bafo, que evapora devagar.

const SP = 4.6 // distância vertical entre os blocos
const FOG = 256

const NOISE = /* glsl */ `
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  vec2 sph(vec3 p){ vec3 d = normalize(p + 1e-5); return vec2(atan(d.z, d.x) / 6.2831853 + 0.5, acos(clamp(d.y, -1., 1.)) / 3.14159265); }
`

// estúdio: duas caixas de luz e uma faixa alta, refletidas no vidro
const STUDIO = /* glsl */ `
  float box(vec3 d, vec3 n, vec2 s){
    float c = dot(d, n); if (c <= 0.0) return 0.0;
    vec3 t = normalize(cross(n, vec3(0.,1.,0.)) + 1e-4); vec3 b = cross(t, n);
    vec2 p = vec2(dot(d, t), dot(d, b)) / c;
    return smoothstep(s.x, s.x * 0.7, abs(p.x)) * smoothstep(s.y, s.y * 0.7, abs(p.y));
  }
  vec3 studio(vec3 d){
    vec3 c = vec3(0.004, 0.0036, 0.0032);
    c += box(d, normalize(vec3(-0.55, 0.75, 0.45)), vec2(0.5, 0.26)) * vec3(5.0, 4.5, 4.0);
    c += box(d, normalize(vec3(0.95, 0.15, 0.2)), vec2(0.07, 0.75)) * vec3(3.4, 3.5, 3.8);
    c += box(d, normalize(vec3(-0.2, -0.2, 1.0)), vec2(0.9, 0.05)) * vec3(0.35, 0.3, 0.26);
    c += smoothstep(0.1, -0.9, d.y) * vec3(0.05, 0.032, 0.02);
    c += smoothstep(-0.3, 1.0, d.y) * vec3(0.09, 0.083, 0.075);
    // variação larga do ambiente: cada face do vidro pega um tom diferente
    c *= 0.6 + 0.8 * smoothstep(-0.6, 0.9, sin(d.x * 3.1 + d.y * 1.7) * sin(d.z * 2.3 - d.y * 2.9));
    return c;
  }
`

type Item = {
  h: House
  i: number
  pose: THREE.Object3D
  glass: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  back: THREE.Mesh
  cloud: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null
  cloudData: Cloud | null
  haze: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  fog: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  fogI: number
  fogLevel: number
  signs: [number, number, number]
  orbit: { r: number; a: number; w: number; y: number; z: number }[]
  slot: { w: number; h: number; d: number; y: number }
}

export class Vitrine implements Place {
  name = 'vitrine'
  length = HOUSES.length - 1
  stops = HOUSES.map((_, i) => i)
  rtMain = rt(2, 2, 4)
  rtOut = rt(2, 2)
  rtBg = rt(2, 2)
  rtBack: THREE.WebGLRenderTarget
  bloom = 0.95
  bloomStrength = 0.55
  cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  scene = new THREE.Scene()
  bgScene = new THREE.Scene()
  backScene = new THREE.Scene()
  items: Item[] = []
  bgMat: THREE.ShaderMaterial
  backMat: THREE.ShaderMaterial
  fogMat: THREE.ShaderMaterial
  fogScene = new THREE.Scene()
  fogCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  ray = new THREE.Raycaster()
  w = 1
  h = 1
  dpr = 1
  local = 0
  active = -1
  labelsOn = false
  labelT = 0
  L: { title: Label; read: Label; enter: Label; kind: Label }
  lastHit = -1
  hoverGlass = false
  casa: Casa
  cut = new Cut()
  detail = 0 // 0..1 transição para a página da casa
  detailTarget = 0
  detailCenter = new THREE.Vector2(0.5, 0.5)
  dive = 0
  settled = -1
  ready = false

  constructor(r: THREE.WebGLRenderer, ov: Overlay) {
    this.rtBack = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true })

    // fundo: gradiente quente, grade de pontos que anda com o mundo, caixas de luz desfocadas
    this.bgMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { uRes: { value: new THREE.Vector2() }, uScroll: { value: 0 }, uMouse: { value: new THREE.Vector2() }, uTime: { value: 0 }, uDpr: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.); }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uRes; uniform float uScroll; uniform vec2 uMouse; uniform float uTime; uniform float uDpr;
        varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 uv = vUv;
          float asp = uRes.x / uRes.y;
          vec3 c = mix(vec3(0.010, 0.0088, 0.0076), vec3(0.020, 0.017, 0.014), smoothstep(0.0, 1.0, uv.y));
          // grade de pontos a cada 125px, presa ao mundo
          vec2 px = uv * uRes / uDpr;
          px.y += uScroll;
          vec2 g = mod(px + 62.5, 125.0) - 62.5;
          float dotv = smoothstep(1.2, 0.4, length(g));
          float fade = 0.5 + 0.5 * n2(floor((px + 62.5) / 125.0) * 0.7 + uTime * 0.05);
          c += vec3(0.085, 0.08, 0.075) * dotv * fade;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat)
    bgQuad.frustumCulled = false
    bgQuad.renderOrder = -10
    this.bgScene.add(bgQuad)

    // passada de trás: profundidade linear das faces de trás
    this.backMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vZ; void main(){ gl_FragColor = vec4(vZ, 0., 0., 1.); }`,
    })

    // simulação do bafo no vidro (por bloco, em coordenadas esféricas do objeto)
    this.fogMat = new THREE.ShaderMaterial({
      depthTest: false,
      uniforms: { tPrev: { value: null }, uSplat: { value: new THREE.Vector2() }, uR: { value: 0.05 }, uAmt: { value: 0 }, uDecay: { value: 0.004 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPrev; uniform vec2 uSplat; uniform float uR, uAmt, uDecay, uTime;
        varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 t = vec2(1.0 / ${FOG}.0);
          float f = texture2D(tPrev, vUv).r;
          float nb = (texture2D(tPrev, vUv + vec2(t.x, 0.)).r + texture2D(tPrev, vUv - vec2(t.x, 0.)).r
                    + texture2D(tPrev, vUv + vec2(0., t.y)).r + texture2D(tPrev, vUv - vec2(0., t.y)).r) * 0.25;
          f = mix(f, nb, 0.1);
          // evapora mais rápido onde é fino, num desenho irregular (borda recua para dentro)
          float n = n2(vUv * vec2(26.0, 13.0) + uTime * 0.03) * 0.7 + n2(vUv * vec2(90.0, 45.0)) * 0.3;
          f -= uDecay * (0.35 + n * 1.3) * (1.15 - f * 0.6);
          vec2 d = vUv - uSplat; d.x -= floor(d.x + 0.5); d.x *= 2.0;
          f += uAmt * exp(-dot(d, d) / (uR * uR));
          gl_FragColor = vec4(clamp(f, 0.0, 1.0), 0., 0., 1.);
        }`,
    })
    const fq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fogMat)
    fq.frustumCulled = false
    this.fogScene.add(fq)

    HOUSES.forEach((h, i) => this.items.push(this.makeItem(h, i)))
    this.casa = new Casa(r, ov)

    const o = { size: 10.5, spacing: 0.55, dur: 0.75 }
    this.L = {
      title: new Label(ov, '', { ...o, lineHeight: 1.55 }),
      read: new Label(ov, '', { ...o, size: 10, lineHeight: 1.6 }),
      enter: new Label(ov, '', { ...o, align: 'right', lineHeight: 1.6 }),
      kind: new Label(ov, '', { ...o, size: 10, lineHeight: 1.6 }),
    }
  }

  makeItem(h: House, i: number): Item {
    const S = shapeFor(h)
    const R = rng(i * 31 + 7)
    const pose = new THREE.Object3D()
    const fog: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [0, 1].map(
      () => new THREE.WebGLRenderTarget(FOG, FOG, { type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping }),
    ) as any
    const glass = new THREE.Mesh(
      S.geo,
      new THREE.ShaderMaterial({
        uniforms: {
          tBg: { value: null },
          tBack: { value: null },
          tFog: { value: fog[0].texture },
          uRes: { value: new THREE.Vector2() },
          uTime: { value: 0 },
          uOpacity: { value: 1 },
          uGlow: { value: 0 },
          uProj: { value: new THREE.Matrix4() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW; varying vec3 vView; varying vec3 vLocal; varying vec4 vClip;
          void main(){
            vLocal = position;
            vec4 w = modelMatrix * vec4(position, 1.);
            vW = w.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 mv = viewMatrix * w;
            vView = mv.xyz;
            vClip = projectionMatrix * mv;
            gl_Position = vClip;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tBg, tBack, tFog; uniform vec2 uRes; uniform float uTime, uOpacity, uGlow; uniform mat4 uProj;
          varying vec3 vN; varying vec3 vW; varying vec3 vView; varying vec3 vLocal; varying vec4 vClip;
          ${NOISE}
          ${STUDIO}
          vec2 proj(vec3 v){ vec4 c = uProj * vec4(v, 1.); return c.xy / c.w * 0.5 + 0.5; }
          vec3 bgBlur(vec2 uv, float r){
            if (r < 0.0005) return texture2D(tBg, uv).rgb;
            vec3 s = vec3(0.0);
            for (int i = 0; i < 8; i++){ float a = float(i) * 2.39996 + 0.5; float rr = r * sqrt((float(i) + 0.5) / 8.0);
              s += texture2D(tBg, uv + vec2(cos(a), sin(a)) * rr).rgb; }
            return s / 8.0;
          }
          void main(){
            vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
            vec3 V = normalize(cameraPosition - vW);
            vec3 N = normalize(vN);
            // vidro fundido à mão: ondulação muito leve na superfície
            vec3 q = vLocal * 3.0;
            N = normalize(N + (vec3(n3(q), n3(q + 7.1), n3(q + 3.3)) - 0.5) * 0.06);
            float fog = texture2D(tFog, sph(vLocal)).r;
            fog = smoothstep(0.02, 0.75, fog);

            float backZ = texture2D(tBack, suv).r;
            float th = backZ > 0.0 ? clamp(backZ - (-vView.z), 0.02, 3.0) : 0.4;
            // refração por canal: o raio atravessa a espessura e sai em outro ponto da tela
            vec3 Nv = normalize(mat3(viewMatrix) * N);
            vec3 I = normalize(vView);
            vec3 col = vec3(0.0);
            float blur = fog * 0.022;
            vec3 iors = vec3(1.0 / 1.50, 1.0 / 1.515, 1.0 / 1.535);
            for (int c = 0; c < 3; c++) {
              vec3 Rr = refract(I, Nv, iors[c]);
              vec2 uv2 = proj(vView + Rr * th * 0.9);
              vec3 s = bgBlur(clamp(uv2, 0.001, 0.999), blur);
              col[c] = s[c];
            }
            // absorção de vidro grosso: fica verde-acinzentado nas partes espessas
            col *= exp(-th * vec3(0.3, 0.1, 0.24));
            // bafo: luz espalhada e branca, e gotículas
            float lum = dot(col, vec3(0.333));
            col = mix(col, vec3(lum) * 1.2 + vec3(0.03, 0.029, 0.027), fog * 0.55);
            float drop = step(0.9, n3(vLocal * 260.0)) * smoothstep(0.25, 0.6, fog) * smoothstep(1.0, 0.7, fog);

            float ndv = clamp(dot(N, V), 0.0, 1.0);
            float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
            vec3 Rw = reflect(-V, N);
            vec3 refl = studio(Rw);
            refl = mix(refl, vec3(dot(refl, vec3(0.333))) * 0.6, fog * 0.7);
            // reflexão interna nas bordas (o vidro "acende" nas quinas)
            vec3 Rin = refract(-V, N, 1.0 / 1.5);
            vec3 tir = studio(reflect(Rin, -N)) * smoothstep(0.3, 0.9, 1.0 - ndv) * 0.8;
            vec3 outc = col * (1.0 - F) + refl * F + tir + drop * studio(Rw + vec3(0.0, 0.3, 0.0)) * 0.5;
            outc += vec3(1.0, 0.8, 0.6) * uGlow * 0.04 * smoothstep(0.6, 1.0, 1.0 - ndv);
            gl_FragColor = vec4(outc, uOpacity);
          }`,
      }),
    )
    glass.matrixAutoUpdate = false
    glass.frustumCulled = false
    this.scene.add(glass)
    const back = new THREE.Mesh(S.geo, this.backMat)
    back.matrixAutoUpdate = false
    back.frustumCulled = false
    this.backScene.add(back)

    // luz de baixo: um halo morno sob o bloco
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 18),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uA: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform float uA; uniform float uTime; varying vec2 vUv;
          ${NOISE}
          void main(){
            // luz de fundo atrás do bloco e um pouco de fumaça embaixo
            vec2 w = (vUv - 0.5) * vec2(24.0, 18.0);
            vec2 p = (w - vec2(0.0, 0.5)) * vec2(1.0, 1.25);
            float back = exp(-dot(p, p) * 0.16);
            vec2 q = (w - vec2(0.0, -2.6)) * vec2(0.55, 1.8);
            float smoke = exp(-dot(q, q) * 0.5) * (0.6 + 0.4 * n2(w * vec2(0.6, 0.9) + vec2(uTime * 0.05, -uTime * 0.08)));
            vec3 c = vec3(1.0, 0.74, 0.5) * back * 0.05 + vec3(1.0, 0.7, 0.45) * smoke * 0.05;
            gl_FragColor = vec4(c * uA, 1.0); }`,
      }),
    )
    haze.renderOrder = -5
    this.bgScene.add(haze)

    const it: Item = {
      h,
      i,
      pose,
      glass,
      back,
      cloud: null,
      cloudData: null,
      haze,
      fog,
      fogI: 0,
      fogLevel: 0,
      signs: [R() > 0.5 ? 1 : -1, R() > 0.5 ? 1 : -1, R() > 0.5 ? 1 : -1],
      orbit: Array.from({ length: 18 }, () => ({ r: 1.55 + R() * 0.75, a: R() * Math.PI * 2, w: (0.04 + R() * 0.07) * (R() > 0.5 ? 1 : -1), y: (R() - 0.5) * 2.6, z: R() * Math.PI * 2 })),
      slot: S.slot,
    }
    return it
  }

  async load(onEach?: () => void) {
    await Promise.all(
      this.items.map(async (it, i) => {
        const c = await engrave(it.h, it.slot, it.h.engrave.text ? 22000 : 34000, i + 1)
        it.cloudData = c
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(c.pos.subarray(0, c.count * 3), 3))
        g.setAttribute('aR', new THREE.BufferAttribute(c.rnd.subarray(0, c.count), 1))
        g.setAttribute('aL', new THREE.BufferAttribute(c.lum.subarray(0, c.count), 1))
        g.translate(0, it.slot.y, 0)
        const pts = new THREE.Points(g, cloudMaterial(c.h, it.slot.y))
        pts.matrixAutoUpdate = false
        pts.frustumCulled = false
        this.bgScene.add(pts)
        it.cloud = pts
        this.casa.setCloud(i, c, it.slot.y)
        onEach?.()
      }),
    )
    this.ready = true
  }

  get rt() {
    return this.detail > 0.001 ? this.rtOut : this.rtMain
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.dpr = dpr
    const W = Math.round(w * dpr)
    const H = Math.round(h * dpr)
    this.rtMain.setSize(W, H)
    this.rtOut.setSize(W, H)
    this.rtBg.setSize(W, H)
    this.rtBack.setSize(Math.round(W / 2), Math.round(H / 2))
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 46 : 32
    this.cam.updateProjectionMatrix()
    this.bgMat.uniforms.uRes.value.set(W, H)
    this.bgMat.uniforms.uDpr.value = dpr
    this.items.forEach((it) => {
      it.glass.material.uniforms.uRes.value.set(W, H)
      if (it.cloud) it.cloud.material.uniforms.uDpr.value = dpr
    })
    this.casa.resize(w, h, dpr)
  }

  hide() {
    this.showLabels(false)
    this.active = -1
    this.casa.hide()
  }

  showLabels(on: boolean) {
    if (on === this.labelsOn) return
    this.labelsOn = on
    this.labelT = 0
    const L = this.L
    L.title.show(on)
    L.read.show(on, on ? 0.12 : 0)
    L.enter.show(on, on ? 0.24 : 0)
    L.kind.show(on, on ? 0.18 : 0)
  }

  setTexts(i: number) {
    const h = HOUSES[i]
    const it = this.items[i]
    this.L.title.set(`CASA_${pad(i + 1)} / ${pad(HOUSES.length)}\n${h.name.toUpperCase()}`)
    this.L.read.set(`PONTOS   ${(it.cloudData?.count ?? 0).toLocaleString('pt-BR')}\nHORA     ${goianiaClock()}`)
    this.L.enter.set(`${h.where.toUpperCase()}\n[ ENTRAR ]`)
    this.L.kind.set(h.kind.toUpperCase())
  }

  update(local: number, f: Frame) {
    const dt = f.dt
    const t = f.t
    this.local = local
    // a página da casa toma conta
    if (this.detail > 0.001) this.casa.update(f, this.detail)

    // câmera percorre a pilha; o mouse inclina de leve
    const camY = -local * SP
    const mx = f.pointer.inside ? f.pointer.x : 0
    const my = f.pointer.inside ? f.pointer.y : 0
    this.cam.position.x += (mx * 0.35 - this.cam.position.x) * damp(0.05, dt)
    const ty = camY + my * 0.2
    this.cam.position.y = ty
    this.cam.position.z = 9.2 - this.dive * 3.6
    this.cam.fov = (this.w / this.h < 1 ? 46 : 32) - clamp(Math.abs(f.vel), 0, 3) * 2.2
    this.cam.updateProjectionMatrix()
    this.cam.lookAt(this.cam.position.x * 0.3, camY, 0)
    this.bgMat.uniforms.uScroll.value = -camY * 120
    this.bgMat.uniforms.uMouse.value.set(mx, my)
    this.bgMat.uniforms.uTime.value = t

    // qual bloco está no centro
    const near = Math.round(clamp(local, 0, this.items.length - 1))
    const dNear = Math.abs(local - near)

    let hitItem = -1
    if (f.pointer.inside && this.detail < 0.01 && f.vis > 0.5) {
      this.ray.setFromCamera(new THREE.Vector2(f.pointer.x, f.pointer.y), this.cam)
      const it = this.items[near]
      it.glass.updateMatrixWorld()
      const hits = this.ray.intersectObject(it.glass, false)
      if (hits.length) {
        hitItem = near
        const lp = it.glass.worldToLocal(hits[0].point.clone())
        const d = lp.clone().normalize()
        const u = Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5
        const v = Math.acos(clamp(d.y, -1, 1)) / Math.PI
        const sp = clamp(f.pointer.speed / 1400)
        this.splat(f, it, u, 1 - v, 0.035 + sp * 0.05, f.pointer.moved < 0.1 ? 0.07 + sp * 0.25 : 0)
      }
    }
    this.hoverGlass = hitItem >= 0 && this.labelsOn

    for (const it of this.items) {
      const d = it.i - local
      const ad = Math.abs(d)
      const vis = ad < 1.6
      it.glass.visible = vis
      it.back.visible = vis
      if (it.cloud) it.cloud.visible = vis
      it.haze.visible = vis
      if (!vis) continue
      // longe do centro, gira; perto, assenta de frente para a câmera
      const k = Math.sign(d) * Math.pow(ad, 1.2)
      const s = it.signs
      const idle = Math.sin(t * 0.35 + it.i) * 0.06
      const tiltX = -my * 0.12 * smooth(0.6, 0, ad)
      const tiltY = mx * 0.18 * smooth(0.6, 0, ad)
      it.pose.position.set(0, -it.i * SP, 0)
      it.pose.rotation.set(k * 1.1 * s[0] + tiltX, k * 1.4 * s[1] + idle + tiltY, k * 0.6 * s[2])
      const sc = 1 - smooth(0.4, 1.4, ad) * 0.12
      it.pose.scale.setScalar(sc)
      it.pose.updateMatrix()
      it.glass.matrix.copy(it.pose.matrix)
      it.back.matrix.copy(it.pose.matrix)
      if (it.cloud) {
        it.cloud.matrix.copy(it.pose.matrix)
        const u = it.cloud.material.uniforms
        u.uTime.value = t
        u.uOpacity.value = 1 - smooth(0.6, 1.5, ad)
      }
      it.haze.position.set(0, -it.i * SP - 0.3, -3.2)
      it.haze.material.uniforms.uA.value = 1 - smooth(0.3, 1.2, ad)
      it.haze.material.uniforms.uTime.value = t
      it.glass.material.uniforms.uTime.value = t
      it.glass.material.uniforms.uGlow.value = 1 - smooth(0, 0.5, ad)
      // o bafo continua evaporando mesmo sem mouse
      if (it.i !== hitItem && it.fogLevel > 0) this.splat(f, it, 0, 0, 0.05, 0)
    }

    // ficha do bloco do centro
    const settledNow = dNear < 0.12 && Math.abs(f.vel) < 0.35 && this.detail < 0.01 && f.vis > 0.6 && this.ready
    if (settledNow && this.active !== near) {
      this.active = near
      this.setTexts(near)
      if (this.labelsOn) {
        this.L.title.replay()
        this.L.read.replay()
        this.L.enter.replay()
        this.L.kind.replay()
      }
      f.sound.beep(0.2)
      if (this.settled !== near) f.sound.glass(0.75 + near * 0.06, 0.6)
      this.settled = near
    }
    this.showLabels(settledNow)
    if (!settledNow && dNear > 0.3) this.settled = -1
    if (this.labelsOn) {
      this.labelT += dt
      if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) {
        const it = this.items[near]
        this.L.read.set(`PONTOS   ${(it.cloudData?.count ?? 0).toLocaleString('pt-BR')}\nHORA     ${goianiaClock()}`)
      }
    }
    this.drawFicha(f, near)
    f.sound.setDyn('vitrine', 1 + clamp(this.items[near].fogLevel) * 1.4)
  }

  splat(f: Frame, it: Item, u: number, v: number, r: number, amt: number) {
    const r_ = f.engine.r
    const m = this.fogMat.uniforms
    m.tPrev.value = it.fog[it.fogI].texture
    m.uSplat.value.set(u, v)
    m.uR.value = r
    m.uAmt.value = amt
    m.uDecay.value = 0.0042 * f.dt * 60
    m.uTime.value = f.t
    it.fogI = 1 - it.fogI
    const fq = this.fogScene.children[0] as THREE.Mesh
    fq.material = this.fogMat
    r_.setRenderTarget(it.fog[it.fogI])
    r_.render(this.fogScene, this.fogCam)
    it.glass.material.uniforms.tFog.value = it.fog[it.fogI].texture
    it.fogLevel = Math.max(0, it.fogLevel * Math.pow(0.4, f.dt) + amt * 0.6)
  }

  drawFicha(f: Frame, near: number) {
    const L = this.L
    const a = f.vis * (1 - this.detail)
    L.title.alpha = a
    L.read.alpha = a * 0.85
    L.enter.alpha = a
    L.kind.alpha = a * 0.7
    if (!this.labelsOn && L.title.p <= 0) return
    const it = this.items[near]
    // caixa do objeto na tela
    const bb = it.glass.geometry.boundingBox!
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const v = new THREE.Vector3()
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(it.pose.matrix)
      const s = toScreen(v, this.cam, this.w, this.h)
      x0 = Math.min(x0, s.x)
      x1 = Math.max(x1, s.x)
      y0 = Math.min(y0, s.y)
      y1 = Math.max(y1, s.y)
    }
    // no celular, a ficha fica dentro da tela
    const narrow = this.w < 760
    if (narrow) {
      x0 = Math.max(x0, 92)
      x1 = Math.min(x1, this.w - 92)
    }
    const draw = ease(clamp(this.labelT / 0.5))
    const lines = f.ov.lines
    const la = a * 0.6
    // título: acima e à esquerda, sublinhado e cotovelo até a quina do objeto
    const tx = narrow ? 24 : x0 - 70
    const ty = y0 - 34
    L.title.place(tx, ty)
    const ux = tx + L.title.width - 8
    const uy = ty + L.title.height - 2
    lines.seg(tx, uy, tx + (ux - tx) * draw, uy, la)
    const ax = x0 + (x1 - x0) * 0.16
    const ay = y0 + (y1 - y0) * 0.12
    if (draw > 0.5) {
      const k = (draw - 0.5) * 2
      lines.seg(ux, uy, ux + (ax - ux) * k, uy + (ay - uy) * k, la)
      if (k > 0.98) f.ov.dots.dot(ax, ay, 3, a)
    }
    // leitura viva: acima à direita
    L.read.place(narrow ? this.w - 24 - L.read.width + 8 : x1 - 10, narrow ? y0 - 34 : y0 + 6)
    // entrar: embaixo à direita, com sublinhado e cotovelo
    const ex = narrow ? this.w - 24 : x1 + 70
    const ey = y1 - 6
    L.enter.place(ex, ey)
    const eux = ex - L.enter.width + 8
    const euy = ey + L.enter.height - 2
    lines.seg(ex, euy, ex - (ex - eux) * draw, euy, la)
    const bx = x0 + (x1 - x0) * 0.86
    const by = y0 + (y1 - y0) * 0.84
    if (draw > 0.5) {
      const k = (draw - 0.5) * 2
      lines.seg(eux, euy, eux + (bx - eux) * k, euy + (by - euy) * k, la)
      if (k > 0.98) f.ov.dots.dot(bx, by, 3, a)
    }
    L.kind.place(narrow ? 24 : x0 - 70, y1 + 14)

    // constelação que orbita o bloco
    const po = this.items[near]
    const P: { x: number; y: number }[] = []
    const c = new THREE.Vector3()
    for (const o of po.orbit) {
      const ang = o.a + f.t * o.w
      c.set(Math.cos(ang) * o.r * 1.15, -po.i * SP + o.y + Math.sin(f.t * 0.3 + o.z) * 0.08, Math.sin(ang) * o.r * 0.7)
      const s = toScreen(c, this.cam, this.w, this.h)
      P.push({ x: s.x, y: s.y })
    }
    const pd = ease(clamp((this.labelT - 0.2) / 0.35))
    const cnt = new Array(P.length).fill(0)
    for (let i = 0; i < P.length; i++) {
      f.ov.dots.dot(P[i].x, P[i].y, 2, a * 0.7 * pd)
      for (let j = i + 1; j < P.length; j++) {
        if (cnt[i] >= 3 || cnt[j] >= 3) continue
        const d = Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y)
        if (d > 210) continue
        cnt[i]++
        cnt[j]++
        const al = a * 0.22 * (1 - d / 210)
        lines.seg(P[i].x, P[i].y, P[i].x + (P[j].x - P[i].x) * pd, P[i].y + (P[j].y - P[i].y) * pd, al)
      }
    }
  }

  hover() {
    return this.hoverGlass || (this.detail > 0.5 && this.casa.hover())
  }

  click(f: Frame) {
    if (this.detail > 0.5) return this.casa.click(f, () => this.close(f))
    if (!this.hoverGlass) return false
    this.open(f, this.active)
    return true
  }

  key(k: string, f: Frame) {
    if (k === 'Escape' && this.detailTarget > 0) {
      this.close(f)
      return true
    }
    if (k === 'Enter' && this.labelsOn && this.detailTarget === 0) {
      this.open(f, this.active)
      return true
    }
    return false
  }

  captureScroll() {
    return this.detailTarget > 0
  }

  scroll(dy: number) {
    this.casa.scroll(dy)
  }

  anim: { from: number; to: number; t: number; dur: number; key: 'detail' | 'dive' }[] = []
  tween(key: 'detail' | 'dive', to: number, dur: number, delay = 0) {
    this.anim = this.anim.filter((a) => a.key !== key)
    this.anim.push({ from: this[key], to, t: -delay, dur, key })
  }

  open(f: Frame, i: number) {
    if (i < 0) return
    this.detailTarget = 1
    this.detailCenter.set(f.pointer.px / this.w, 1 - f.pointer.py / this.h)
    this.casa.open(i)
    this.tween('dive', 1, 1.1)
    this.tween('detail', 1, 1.25, 0.35)
    f.sound.glass(1.2, 1)
    f.sound.whoosh(1.2, 0.8, 200, 1800)
  }

  close(f: Frame) {
    this.detailTarget = 0
    this.detailCenter.set(0.5, 0.5)
    this.tween('detail', 0, 1.1)
    this.tween('dive', 0, 1.3, 0.2)
    this.casa.closing()
    f.sound.whoosh(1.0, 0.6, 1800, 250)
    return true
  }

  render(r: THREE.WebGLRenderer, f: Frame) {
    // animações internas
    for (const a of this.anim) {
      a.t += f.dt
      const p = clamp(a.t / a.dur)
      const e = a.key === 'dive' && a.to > a.from ? p * p * p : ease(p)
      this[a.key] = a.from + (a.to - a.from) * e
    }
    this.anim = this.anim.filter((a) => a.t < a.dur)

    if (this.detail < 0.999) {
      // 1) fundo e gravações
      r.setRenderTarget(this.rtBg)
      r.render(this.bgScene, this.cam)
      // 2) faces de trás
      r.setClearColor(0x000000, 1)
      r.setRenderTarget(this.rtBack)
      r.render(this.backScene, this.cam)
      r.setClearColor(0x0c0b0a, 1)
      // 3) vidro por cima do fundo
      for (const it of this.items) {
        const u = it.glass.material.uniforms
        u.tBg.value = this.rtBg.texture
        u.tBack.value = this.rtBack.texture
        u.uProj.value.copy(this.cam.projectionMatrix)
      }
      r.setRenderTarget(this.rtMain)
      r.clear()
      blit(r, this.rtBg.texture)
      r.autoClear = false
      r.render(this.scene, this.cam)
      r.autoClear = true
    }
    if (this.detail > 0.001) {
      this.casa.render(r, f)
      this.cut.run(r, this.rtMain.texture, this.casa.rt.texture, this.detail, this.rtOut, {
        mode: 1,
        center: this.detailCenter,
        aspect: this.w / this.h,
        t: f.t,
      })
    }
  }
}

// copia uma textura para o alvo atual sem limpar
const blitMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: { t: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.); }`,
})
const blitScene = new THREE.Scene()
const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat)
blitQuad.frustumCulled = false
blitScene.add(blitQuad)
function blit(r: THREE.WebGLRenderer, t: THREE.Texture) {
  blitMat.uniforms.t.value = t
  const ac = r.autoClear
  r.autoClear = false
  r.render(blitScene, blitCam)
  r.autoClear = ac
}

export function cloudMaterial(h: number, y0: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uDpr: { value: 1 },
      uH: { value: h },
      uY0: { value: y0 },
      uMouse: { value: new THREE.Vector3(0, 0, 100) },
      uMouseDir: { value: new THREE.Vector3(0, 0, -1) },
      uPush: { value: 0 },
      uScale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aR; attribute float aL;
      uniform float uTime, uDpr, uH, uY0, uPush, uScale; uniform vec3 uMouse, uMouseDir;
      varying float vB;
      void main(){
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        // empurrão do cursor (só na página da casa): distância do ponto ao raio do mouse
        if (uPush > 0.0) {
          vec3 m = w.xyz - uMouse;
          vec3 perp = m - uMouseDir * dot(m, uMouseDir);
          float d = length(perp);
          w.xyz += normalize(perp + 1e-4) * smoothstep(0.9, 0.0, d) * 0.35 * uPush;
        }
        vec4 mv = viewMatrix * w;
        float hgt = clamp((p.y - uY0) / max(uH, 0.1) + 0.5, 0.0, 1.0);
        vec3 V = normalize(cameraPosition - w.xyz);
        vec3 nd = normalize(mat3(modelMatrix) * normalize(vec3(sin(aR * 91.0), cos(aR * 47.0), sin(aR * 13.0 + 1.0))));
        float sparkle = pow(max(dot(nd, V), 0.0), 60.0) * 3.0;
        vB = (0.5 + aL * 0.5) * mix(1.25, 0.55, hgt) + sparkle;
        gl_PointSize = (0.75 + aR * 0.6 + sparkle * 0.6) * uDpr * uScale * (9.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; varying float vB;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d);
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.86) * a * vB * uOpacity * 0.3, 1.0);
      }`,
  })
}
