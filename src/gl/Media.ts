import * as THREE from 'three'

// Todas as fotos do site passam por aqui: cada <figure data-gl> ganha um plano em WebGL
// que segue o retângulo do DOM. Um só shader pra todas — é o que as faz da mesma família:
// fenda vertical que abre (uma ou várias), curvatura pela velocidade do scroll,
// lente sob o cursor e o mesmo grão.

THREE.ColorManagement.enabled = false

const vert = /* glsl */ `
  uniform vec2 uSize;
  uniform float uVel;
  uniform float uTilt;
  varying vec2 vUv;
  const float PI = 3.14159265;
  void main() {
    vUv = uv;
    vec3 p = vec3(position.xy * uSize, 0.0);
    // o centro atrasa em relação às bordas quando a página corre
    p.y -= uVel * (1.0 - pow(abs(position.x) * 2.0, 2.0)) * 0.9;
    // galeria curva: inclinação em Y feita aqui pra manter o plano preso ao centro
    float a = uTilt;
    p = vec3(p.x * cos(a), p.y, -p.x * sin(a) - abs(sin(a)) * uSize.x * 0.35);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tMap;
  uniform vec2 uSize;
  uniform float uAspect;
  uniform float uReveal;
  uniform float uSlits;
  uniform float uHover;
  uniform vec2 uMouse;
  uniform float uZoom;
  uniform float uVel;
  uniform float uTime;
  uniform float uDim;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    // fenda: cada faixa abre do seu centro; com várias faixas, abrem em cascata
    float n = max(uSlits, 1.0);
    float idx = floor(vUv.x * n);
    float fx = fract(vUv.x * n);
    float r = clamp(uReveal * (1.0 + (n - 1.0) * 0.06) - idx * 0.06, 0.0, 1.0);
    float half_ = r * 0.5;
    float edgePx = 1.0 / (uSize.x / n);
    float m = smoothstep(half_ + edgePx, half_ - edgePx, abs(fx - 0.5));
    if (m <= 0.001) discard;

    // enquadramento "cover" + zoom que acompanha a abertura
    float pa = uSize.x / uSize.y;
    vec2 s = pa > uAspect ? vec2(1.0, uAspect / pa) : vec2(pa / uAspect, 1.0);
    vec2 uv = (vUv - 0.5) * s / (uZoom + (1.0 - r) * 0.18) + 0.5;

    // lente sob o cursor
    vec2 d = vUv - uMouse;
    float dist = length(d * vec2(pa, 1.0));
    float lens = smoothstep(0.32, 0.0, dist) * uHover;
    uv -= d * s * lens * 0.18;

    // estica um pouco na direção do scroll
    uv.y = (uv.y - 0.5) * (1.0 - clamp(abs(uVel) * 0.0012, 0.0, 0.08)) + 0.5;

    vec3 col = texture2D(tMap, uv).rgb;
    col *= uDim;
    col += (hash(vUv * uSize + uTime) - 0.5) * 0.05;
    gl_FragColor = vec4(col, m);
  }
`

export type Media = {
  el: HTMLElement
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  reveal: number
  slits: number
  hover: number
  hoverT: number
  mouse: THREE.Vector2
  tilt: number
  dim: number
  zoom: number
}

export class MediaStage {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(30, 1, 10, 20000)
  items: Media[] = []
  vel = 0
  private loader = new THREE.TextureLoader()
  private geo = new THREE.PlaneGeometry(1, 1, 32, 32)
  private clock = new THREE.Clock()
  w = 1
  h = 1

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.resize()
  }

  async add(el: HTMLElement) {
    const img = el.querySelector('img')!
    const tex = await this.loader.loadAsync(img.currentSrc || img.src)
    tex.colorSpace = THREE.NoColorSpace
    tex.anisotropy = 8
    const image = tex.image as HTMLImageElement
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      uniforms: {
        tMap: { value: tex },
        uSize: { value: new THREE.Vector2(1, 1) },
        uAspect: { value: image.width / image.height },
        uReveal: { value: 0 },
        uSlits: { value: 1 },
        uHover: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uZoom: { value: 1 },
        uVel: { value: 0 },
        uTime: { value: 0 },
        uDim: { value: 1 },
        uTilt: { value: 0 },
      },
    })
    const mesh = new THREE.Mesh(this.geo, mat)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    el.classList.add('is-gl')
    const m: Media = {
      el,
      mesh,
      reveal: el.hasAttribute('data-open') ? 1 : 0,
      slits: Number(el.dataset.slits || 1),
      hover: 0,
      hoverT: 0,
      mouse: new THREE.Vector2(0.5, 0.5),
      tilt: 0,
      dim: Number(el.dataset.dim || 1),
      zoom: 1,
    }
    el.addEventListener('pointerenter', () => (m.hoverT = 1))
    el.addEventListener('pointerleave', () => (m.hoverT = 0))
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      m.mouse.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height)
    })
    this.items.push(m)
    return m
  }

  resize() {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.w, this.h, false)
    const fov = (this.camera.fov * Math.PI) / 180
    this.camera.aspect = this.w / this.h
    this.camera.position.set(0, 0, this.h / 2 / Math.tan(fov / 2))
    this.camera.far = this.camera.position.z * 4
    this.camera.updateProjectionMatrix()
  }

  render(vel: number) {
    const t = this.clock.getElapsedTime()
    this.vel += (vel - this.vel) * 0.12
    for (const m of this.items) {
      const r = m.el.getBoundingClientRect()
      const on = r.bottom > -100 && r.top < this.h + 100 && r.right > -100 && r.left < this.w + 100 && m.reveal > 0.001
      m.mesh.visible = on
      if (!on) continue
      m.hover += (m.hoverT - m.hover) * 0.08
      const u = m.mesh.material.uniforms
      u.uSize.value.set(r.width, r.height)
      m.mesh.position.set(r.left + r.width / 2 - this.w / 2, this.h / 2 - (r.top + r.height / 2), 0)
      u.uReveal.value = m.reveal
      u.uSlits.value = m.slits
      u.uHover.value = m.hover
      u.uMouse.value.lerp(m.mouse, 0.15)
      u.uVel.value = this.vel
      u.uTime.value = t
      u.uDim.value = m.dim
      u.uZoom.value = m.zoom
      u.uTilt.value = m.tilt
    }
    this.renderer.render(this.scene, this.camera)
  }
}
