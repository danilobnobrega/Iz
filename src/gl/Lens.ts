import * as THREE from 'three'

// Proposta U — "Foco". Cada foto tem um mapa de profundidade (Depth Anything V2, gerado offline).
// O shader faz o que uma lente faz: paralaxe em torno do plano de foco e desfoque com bokeh
// proporcional à distância desse plano. O foco segue o olho (cursor) com a dinâmica de um autofoco.

THREE.ColorManagement.enabled = false

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uTex;
  uniform vec2 uSize;
  uniform vec2 uView;
  uniform vec2 uRes;
  uniform float uFocus;
  uniform float uAperture;
  uniform float uParallax;
  uniform float uShow;
  uniform float uRipple;
  uniform float uRadius;
  uniform float uExposure;
  uniform float uTime;
  uniform float uDpr;
  uniform vec3 uTint;
  varying vec2 vUv;

  #define SAMPLES 52
  #define ZOOM 0.93
  #define BAND 0.07

  // plano (0..1) -> textura, com "cover" e uma folga para a paralaxe não mostrar a borda
  vec2 cover(vec2 p) {
    float ra = uSize.x / uSize.y;
    float ta = uTex.x / uTex.y;
    vec2 s = ra > ta ? vec2(1.0, ta / ra) : vec2(ra / ta, 1.0);
    return (p - 0.5) * s * ZOOM + 0.5;
  }
  float depthAt(vec2 p) { return texture2D(tDepth, cover(p)).r; }
  vec3 lin(vec2 p) { vec3 c = texture2D(tColor, cover(p)).rgb; return c * c; }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float sdRoundedBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r; }

  void main() {
    vec2 screen = gl_FragCoord.xy / (uRes * uDpr);
    vec2 base = vUv;
    // a velocidade do scroll curva levemente a imagem perto das bordas da tela
    base.x -= (screen.x - 0.5) * (1.0 - sin(screen.y * 3.14159)) * uRipple;

    // paralaxe em torno do plano de foco: o que está no foco não se mexe
    vec2 shift = uView * uParallax / uSize;
    vec2 p = base;
    for (int i = 0; i < 4; i++) p = base - (depthAt(p) - uFocus) * shift;

    float d0 = depthAt(p);
    // profundidade de campo: uma faixa em torno do foco fica nítida, como numa lente real
    float coc0 = max(0.0, abs(d0 - uFocus) - BAND) * uAperture;
    float R = uAperture * 0.55 + 1.0;

    vec3 acc = lin(p);
    float wsum = 1.0;
    float ang = ign(gl_FragCoord.xy) * 0.15;
    for (int i = 0; i < SAMPLES; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / float(SAMPLES)) * R;
      float a = ang + fi * 2.39996323;
      vec2 sp = p + vec2(cos(a), sin(a)) * r / uSize;
      float d = depthAt(sp);
      float coc = max(0.0, abs(d - uFocus) - BAND) * uAperture;
      // o fundo não invade um primeiro plano nítido; o primeiro plano desfocado invade tudo
      float c = mix(min(coc, coc0), coc, smoothstep(d0 - 0.03, d0 + 0.03, d));
      float w = smoothstep(r - 0.75, r + 0.75, c);
      vec3 col = lin(sp);
      // pontos de luz viram discos de bokeh
      w *= 1.0 + pow(dot(col, vec3(0.299, 0.587, 0.114)), 3.0) * 6.0;
      acc += col * w;
      wsum += w;
    }
    vec3 color = sqrt(acc / wsum) * uExposure;

    // revelação: a máscara arredondada cresce e a cor chega depois do tom
    float e = uShow * uShow * (3.0 - 2.0 * uShow);
    vec2 px = (vUv - 0.5) * uSize;
    float m = sdRoundedBox(px, uSize * 0.5 * mix(0.9, 1.0, e), uRadius);
    float mask = smoothstep(0.75, -0.75, m) * smoothstep(0.0, 0.25, uShow);
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(uTint * luma * 1.4, color, smoothstep(0.35, 1.0, uShow));

    // grão fino, o mesmo em toda foto
    float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
    color += (g - 0.5) * 0.025;
    gl_FragColor = vec4(color, mask);
  }
`

// dinâmica de segunda ordem (f = frequência, z = amortecimento, r = resposta inicial)
export class Spring {
  y: number
  yd = 0
  private xp: number
  private k1: number
  private k2: number
  private k3: number
  constructor(f: number, z: number, r: number, x0: number) {
    this.k1 = z / (Math.PI * f)
    this.k2 = 1 / ((2 * Math.PI * f) * (2 * Math.PI * f))
    this.k3 = (r * z) / (2 * Math.PI * f)
    this.y = this.xp = x0
  }
  update(T: number, x: number) {
    T = Math.min(T, 1 / 30)
    const xd = (x - this.xp) / T
    this.xp = x
    const k2 = Math.max(this.k2, (T * T) / 2 + (T * this.k1) / 2, T * this.k1)
    this.y += T * this.yd
    this.yd += (T * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2
    return this.y
  }
  reset(x: number) {
    this.y = this.xp = x
    this.yd = 0
  }
}

type Img = { color: THREE.Texture; depth: THREE.Texture; data: Uint8ClampedArray; dw: number; dh: number; w: number; h: number }

export class Shot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  img: Img
  focus: Spring
  target = 0.5
  aperture = 18
  parallax = 16
  show = 0
  exposure = 1
  subject: [number, number]
  hover = false
  hoverUv: [number, number] = [0.5, 0.5]
  rect = new DOMRect()
  visible = false

  constructor(public el: HTMLElement, img: Img, geo: THREE.PlaneGeometry, tint: THREE.Color) {
    this.img = img
    const s = (el.dataset.subject || '0.5,0.5').split(',').map(Number) as [number, number]
    this.subject = s
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        uniforms: {
          tColor: { value: img.color },
          tDepth: { value: img.depth },
          uTex: { value: new THREE.Vector2(img.w, img.h) },
          uSize: { value: new THREE.Vector2(1, 1) },
          uView: { value: new THREE.Vector2() },
          uRes: { value: new THREE.Vector2(1, 1) },
          uFocus: { value: 0.5 },
          uAperture: { value: 18 },
          uParallax: { value: 16 },
          uShow: { value: 0 },
          uRipple: { value: 0 },
          uRadius: { value: 4 },
          uExposure: { value: 1 },
          uTime: { value: 0 },
          uDpr: { value: 1 },
          uTint: { value: tint },
        },
      }),
    )
    this.mesh.frustumCulled = false
    this.focus = new Spring(1.5, 0.55, 0, 0.5)
    this.focus.reset(this.depthAt(...this.subject))
  }

  setImage(img: Img) {
    this.img = img
    const u = this.mesh.material.uniforms
    u.tColor.value = img.color
    u.tDepth.value = img.depth
    u.uTex.value.set(img.w, img.h)
  }

  // profundidade (0 longe, 1 perto) num ponto do plano, com o mesmo "cover" do shader
  depthAt(px: number, py: number) {
    const { w, h, data, dw, dh } = this.img
    const r = this.rect
    const ra = (r.width || 1) / (r.height || 1)
    const ta = w / h
    const sx = ra > ta ? 1 : ra / ta
    const sy = ra > ta ? ta / ra : 1
    const u = (px - 0.5) * sx * 0.93 + 0.5
    const v = (py - 0.5) * sy * 0.93 + 0.5
    // como um autofoco de verdade: na zona sob o ponto, vale o assunto mais próximo
    let best = 0
    for (let j = -2; j <= 2; j++)
      for (let k = -2; k <= 2; k++) {
        const uu = Math.min(1, Math.max(0, u + k * 0.012))
        const vv = Math.min(1, Math.max(0, v + j * 0.012))
        const i = (Math.min(dh - 1, (vv * dh) | 0) * dw + Math.min(dw - 1, (uu * dw) | 0)) * 4
        best = Math.max(best, data[i])
      }
    return best / 255
  }
}

export class Lens {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  shots: Shot[] = []
  geo = new THREE.PlaneGeometry(1, 1)
  tint = new THREE.Color('#d9c6a8')
  private loader = new THREE.TextureLoader()
  private cache = new Map<string, Promise<Img>>()
  W = 1
  H = 1
  dpr = 1

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.resize()
  }

  load(name: string) {
    let p = this.cache.get(name)
    if (!p) {
      p = (async () => {
        const [color, raw] = await Promise.all([this.loader.loadAsync(`/img/${name}.webp`), this.loader.loadAsync(`/depth/${name}.png`)])
        // a profundidade é suavizada antes de subir: bordas duras viram pontilhado no bokeh
        const ri = raw.image as HTMLImageElement
        const dc = document.createElement('canvas')
        dc.width = ri.width
        dc.height = ri.height
        const dg = dc.getContext('2d')!
        dg.filter = `blur(${Math.max(1.5, ri.width / 700)}px)`
        dg.drawImage(ri, 0, 0)
        const depth = new THREE.CanvasTexture(dc)
        for (const t of [color, depth]) {
          t.colorSpace = THREE.NoColorSpace
          t.minFilter = THREE.LinearFilter
          t.generateMipmaps = false
        }
        // cópia pequena da profundidade na CPU, para o autofoco saber o que está sob o cursor
        const di = dc
        const dw = 160
        const dh = Math.round((dw * di.height) / di.width)
        const c = document.createElement('canvas')
        c.width = dw
        c.height = dh
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(di, 0, 0, dw, dh)
        const ci = color.image as HTMLImageElement
        return { color, depth, data: g.getImageData(0, 0, dw, dh).data, dw, dh, w: ci.width, h: ci.height }
      })()
      this.cache.set(name, p)
    }
    return p
  }

  async add(el: HTMLElement) {
    const shot = new Shot(el, await this.load(el.dataset.shot!), this.geo, this.tint)
    shot.aperture = Number(el.dataset.aperture || 18)
    shot.parallax = Number(el.dataset.parallax || 16)
    shot.mesh.material.uniforms.uRadius.value = Number(el.dataset.radius || 4)
    this.shots.push(shot)
    this.scene.add(shot.mesh)
    el.addEventListener('pointerenter', () => (shot.hover = true))
    el.addEventListener('pointerleave', () => (shot.hover = false))
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      shot.hoverUv = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
    })
    return shot
  }

  resize() {
    this.W = window.innerWidth
    this.H = window.innerHeight
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.W, this.H, false)
    this.camera.left = -this.W / 2
    this.camera.right = this.W / 2
    this.camera.top = this.H / 2
    this.camera.bottom = -this.H / 2
    this.camera.updateProjectionMatrix()
  }

  render(dt: number, time: number, mouse: { x: number; y: number }, ripple: number) {
    const W = this.W
    const H = this.H
    for (const s of this.shots) {
      const r = s.el.getBoundingClientRect()
      s.rect = r
      s.visible = r.bottom > -40 && r.top < H + 40 && r.width > 0
      s.mesh.visible = s.visible && s.show > 0.001
      // o foco vai para onde o olho está; sem olho, para o assunto da foto
      const [fx, fy] = s.hover ? s.hoverUv : s.subject
      s.target = s.depthAt(fx, fy)
      s.focus.update(dt, s.target)
      if (!s.mesh.visible) continue
      const u = s.mesh.material.uniforms
      s.mesh.position.set(r.left + r.width / 2 - W / 2, H / 2 - (r.top + r.height / 2), 0)
      s.mesh.scale.set(r.width, r.height, 1)
      u.uSize.value.set(r.width, r.height)
      u.uRes.value.set(W, H)
      u.uDpr.value = this.dpr
      // a câmera "anda" com o scroll e com o olho
      const sy = Math.max(-1, Math.min(1, (r.top + r.height / 2 - H / 2) / H))
      u.uView.value.set(mouse.x * 0.9, sy * 0.9 - mouse.y * 0.5)
      u.uFocus.value = Math.min(1, Math.max(0, s.focus.y))
      u.uAperture.value = s.aperture
      u.uParallax.value = s.parallax
      u.uShow.value = s.show
      u.uExposure.value = s.exposure
      u.uRipple.value = ripple
      u.uTime.value = time
    }
    this.renderer.render(this.scene, this.camera)
  }
}
