import * as THREE from 'three'
import { HOUSES } from '../v/houses'
import { shapeFor } from '../v/shapes'
import { engrave } from '../v/engrave'
import { Section, Quad, FS_VERT, damp, ease, fit, toScreen, type Ctx, type Rect } from './core'

// "As casas": um trilho horizontal de blocos de vidro fundido, um formato por casa, com uma foto
// da casa gravada a laser por dentro (pontos com relevo). Atrás de cada bloco, o nome da casa em
// letra grande: o vidro dobra o nome. Três passadas: fundo + gravações; profundidade das faces de
// trás (espessura real); face da frente com refração por canal, absorção e reflexo.

const SP = 5.2

const GLASS_FRAG = /* glsl */ `
  uniform sampler2D tBg, tBack; uniform mat4 uProj; uniform float uTime;
  varying vec3 vN; varying vec3 vW; varying vec3 vView; varying vec3 vLocal; varying vec4 vClip;
  float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
    return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
  vec3 env(vec3 d){
    // estúdio claro: céu suave, uma janela alta à esquerda, uma faixa à direita
    vec3 c = mix(vec3(0.78, 0.76, 0.72), vec3(1.0, 0.99, 0.97), smoothstep(-0.3, 0.9, d.y));
    float win = smoothstep(0.8, 0.95, dot(d, normalize(vec3(-0.6, 0.6, 0.5))));
    float strip = smoothstep(0.985, 0.995, dot(normalize(d.xz), normalize(vec2(0.95, 0.3)))) * smoothstep(-0.2, 0.3, d.y);
    return c + win * 0.6 + strip * 0.5;
  }
  vec2 proj(vec3 v){ vec4 c = uProj * vec4(v, 1.0); return c.xy / c.w * 0.5 + 0.5; }
  void main(){
    vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
    vec3 V = normalize(cameraPosition - vW);
    vec3 N = normalize(vN);
    vec3 q = vLocal * 3.0;
    N = normalize(N + (vec3(n3(q), n3(q + 7.1), n3(q + 3.3)) - 0.5) * 0.05);
    float backZ = texture2D(tBack, suv).r;
    float th = backZ > 0.0 ? clamp(backZ - (-vView.z), 0.02, 3.0) : 0.4;
    vec3 Nv = normalize(mat3(viewMatrix) * N);
    vec3 I = normalize(vView);
    vec3 col;
    vec3 iors = vec3(1.0 / 1.5, 1.0 / 1.518, 1.0 / 1.54);
    for (int c = 0; c < 3; c++) {
      vec3 Rr = refract(I, Nv, iors[c]);
      vec2 uv2 = clamp(proj(vView + Rr * th * 0.95), 0.001, 0.999);
      col[c] = texture2D(tBg, uv2)[c];
    }
    col *= exp(-th * vec3(0.16, 0.05, 0.12));
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 refl = env(reflect(-V, N));
    vec3 Rin = refract(-V, N, 1.0 / 1.5);
    vec3 tir = env(reflect(Rin, -N)) * smoothstep(0.35, 0.95, 1.0 - ndv) * 0.25;
    vec3 outc = col * (1.0 - F) + refl * F + tir * 0.5 - smoothstep(0.55, 1.0, 1.0 - ndv) * 0.05;
    gl_FragColor = vec4(outc, 1.0);
    #include <colorspace_fragment>
  }`

const GLASS_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vW; varying vec3 vView; varying vec3 vLocal; varying vec4 vClip;
  void main(){ vLocal = position; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal); vec4 mv = viewMatrix * w; vView = mv.xyz;
    vClip = projectionMatrix * mv; gl_Position = vClip; }`

type Item = { pose: THREE.Object3D; glass: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; back: THREE.Mesh; cloud: THREE.Points | null; name: THREE.Mesh; slotY: number; sign: number }

export class GlassSec extends Section {
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  bgScene = new THREE.Scene()
  backScene = new THREE.Scene()
  scene = new THREE.Scene()
  rtBg = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 })
  rtBack = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType })
  rtBgResolved = this.rtBg
  backMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vZ; void main(){ gl_FragColor = vec4(vZ, 0., 0., 1.); }`,
  })
  items: Item[] = []
  quad = new Quad()
  blit = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.);
    #include <colorspace_fragment>
  }`, depthTest: false, depthWrite: false, uniforms: { t: { value: null } } })
  camX = 0
  tilt = new THREE.Vector2()
  cap: HTMLElement | null
  capI = -1

  constructor(el: HTMLElement) {
    super(el)
    this.bgScene.background = new THREE.Color('#e3e0db')
    this.cap = el.querySelector('.y-house')
    HOUSES.forEach((h, i) => {
      const S = shapeFor(h)
      const pose = new THREE.Object3D()
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: GLASS_FRAG,
        uniforms: { tBg: { value: null }, tBack: { value: null }, uProj: { value: new THREE.Matrix4() }, uTime: { value: 0 } },
      })
      const glass = new THREE.Mesh(S.geo, mat)
      glass.matrixAutoUpdate = false
      this.scene.add(glass)
      const back = new THREE.Mesh(S.geo, this.backMat)
      back.matrixAutoUpdate = false
      this.backScene.add(back)
      // o nome da casa atrás do bloco, para o vidro dobrar
      const cv = document.createElement('canvas')
      cv.width = 2048
      cv.height = 640
      const x = cv.getContext('2d')!
      x.fillStyle = '#17130f'
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      let size = 520
      x.font = `${size}px "Instrument Serif"`
      while (x.measureText(h.name).width > 1960) {
        size -= 10
        x.font = `${size}px "Instrument Serif"`
      }
      x.fillText(h.name, 1024, 330)
      const tex = new THREE.CanvasTexture(cv)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      const name = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 }))
      name.position.set(i * SP, 0.1, -3.2)
      this.bgScene.add(name)
      this.items.push({ pose, glass, back, cloud: null, name, slotY: S.slot.y, sign: i % 2 ? 1 : -1 })
    })
  }

  async init() {
    await Promise.all(
      HOUSES.map(async (h, i) => {
        const S = shapeFor(h)
        const c = await engrave(h, S.slot, h.engrave.text ? 16000 : 26000, i + 1)
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(c.pos.subarray(0, c.count * 3), 3))
        g.setAttribute('aL', new THREE.BufferAttribute(c.lum.subarray(0, c.count), 1))
        g.translate(0, S.slot.y, 0)
        const pts = new THREE.Points(
          g,
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: false,
            uniforms: { uDpr: { value: 1 } },
            vertexShader: /* glsl */ `attribute float aL; uniform float uDpr; varying float vA;
              void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = 0.25 + aL * 0.5;
                gl_PointSize = 1.3 * uDpr * (9.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
            // microfraturas vistas contra papel claro: pontos foscos, levemente mais escuros que o vidro
            fragmentShader: /* glsl */ `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
              gl_FragColor = vec4(vec3(0.32, 0.31, 0.3), vA * smoothstep(0.5, 0.15, d)); }`,
          }),
        )
        pts.matrixAutoUpdate = false
        pts.frustumCulled = false
        this.bgScene.add(pts)
        this.items[i].cloud = pts
      }),
    )
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const W = Math.round(w * dpr)
    const H = Math.round(h * dpr)
    this.rtBg.setSize(W, H)
    this.rtBack.setSize(Math.round(W / 2), Math.round(H / 2))
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 48 : 30
    this.cam.updateProjectionMatrix()
    this.items.forEach((it) => it.cloud && ((it.cloud.material as THREE.ShaderMaterial).uniforms.uDpr.value = dpr))
  }

  update(p: number, c: Ctx, rect: Rect) {
    const n = HOUSES.length
    const raw = fit(p, 0.06, 0.94) * (n - 1)
    const i0 = Math.floor(raw)
    const f = raw - i0
    // anda casa por casa, com uma pausa em cada uma
    const at = i0 + ease(fit(f, 0.3, 0.9))
    const m = this.local(c, rect)
    this.camX += (at * SP - this.camX) * damp(0.09, c.dt)
    this.tilt.x += ((m.inside ? m.x : 0) - this.tilt.x) * damp(0.06, c.dt)
    this.tilt.y += ((m.inside ? m.y : 0) - this.tilt.y) * damp(0.06, c.dt)
    const dist = this.w / this.h < 1 ? 11 : 9
    this.cam.position.set(this.camX + this.tilt.x * 0.4, 0.25 + this.tilt.y * 0.25, dist)
    this.cam.lookAt(this.camX, 0, 0)
    this.items.forEach((it, i) => {
      const d = i * SP - this.camX
      const k = d / SP
      it.pose.position.set(i * SP, Math.sin(c.t * 0.6 + i) * 0.05, 0)
      it.pose.rotation.set(-this.tilt.y * 0.15, k * 0.9 * it.sign + Math.sin(c.t * 0.3 + i) * 0.08 + this.tilt.x * 0.25, k * 0.12)
      it.pose.updateMatrix()
      it.glass.matrix.copy(it.pose.matrix)
      it.back.matrix.copy(it.pose.matrix)
      if (it.cloud) it.cloud.matrix.copy(it.pose.matrix)
      it.name.position.x = i * SP + d * 0.25
    })
    const cur = Math.round(at)
    if (cur !== this.capI && this.cap) {
      this.capI = cur
      const h = HOUSES[cur]
      const target = this.cap.querySelector<HTMLElement>('.y-in') ?? this.cap
      target.innerHTML = `<span class="y-k">${String(cur + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')} · ${h.where}</span><span class="y-s">${h.kind}</span>`
    }
  }

  render(c: Ctx, rect: Rect) {
    const r = c.r
    r.setRenderTarget(this.rtBg)
    r.clear()
    r.render(this.bgScene, this.cam)
    r.setClearColor(0x000000, 1)
    r.setRenderTarget(this.rtBack)
    r.clear()
    r.render(this.backScene, this.cam)
    r.setClearColor(0xe3e0db, 1)
    for (const it of this.items) {
      const u = it.glass.material.uniforms
      u.tBg.value = this.rtBg.texture
      u.tBack.value = this.rtBack.texture
      u.uProj.value.copy(this.cam.projectionMatrix)
      u.uTime.value = c.t
    }
    // fundo na tela, depois o vidro por cima
    this.blit.uniforms.t.value = this.rtBg.texture
    this.quad.screen(c, rect, this.blit)
    toScreen(c, rect, this.scene, this.cam)
  }
}
