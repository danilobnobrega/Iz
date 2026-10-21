import * as THREE from 'three'

// Desenha as fotos que vivem dentro das frases. Cada foto é um retângulo em pixels da tela,
// recortado com cantos redondos, revelado de baixo para cima com uma borda de grão fino, e capaz
// de trocar de imagem com a mesma máscara (a foto que atravessa de uma cena para a outra).

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

const FRAG = /* glsl */ `
  uniform sampler2D tA, tB;
  uniform vec2 uSize;
  uniform float uRatioA, uRatioB, uRadius, uReveal, uHide, uMix, uZoom, uVel, uTime, uAlpha;
  varying vec2 vUv;

  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }

  vec2 cover(vec2 uv, float imgRatio){
    float boxRatio = uSize.x / uSize.y;
    vec2 s = boxRatio > imgRatio ? vec2(1.0, imgRatio / boxRatio) : vec2(boxRatio / imgRatio, 1.0);
    return (uv - 0.5) * s + 0.5;
  }
  float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

  void main(){
    vec2 uv = vUv;
    // a rolagem estica a imagem por dentro, muito de leve
    vec2 c = uv - 0.5;
    uv.y += c.y * clamp(uVel, -2.0, 2.0) * 0.035 * (1.0 - 4.0 * c.x * c.x);
    uv = (uv - 0.5) / uZoom + 0.5;
    vec3 a = texture2D(tA, cover(uv, uRatioA)).rgb;
    vec3 b = texture2D(tB, cover(uv, uRatioB)).rgb;

    vec2 px = vUv * uSize;
    float g = n(px * 0.12) * 0.6 + n(px * 0.035) * 0.4;
    // troca A → B: frente que sobe com borda granulada
    float m = uMix <= 0.0 ? 0.0 : (uMix >= 1.0 ? 1.0 : 1.0 - smoothstep(-0.015, 0.015, vUv.y - uMix * 1.15 + (g - 0.5) * 0.08));
    vec3 col = mix(a, b, m);

    // revelar de baixo para cima e esconder para cima
    float rev = smoothstep(-0.01, 0.01, uReveal * 1.12 - vUv.y - (g - 0.5) * 0.06);
    float hid = 1.0 - smoothstep(-0.01, 0.01, uHide * 1.12 - vUv.y - (g - 0.5) * 0.06);
    float d = rbox(px - uSize * 0.5, uSize * 0.5, min(uRadius, min(uSize.x, uSize.y) * 0.5));
    float shape = 1.0 - smoothstep(-0.75, 0.75, d);
    float alpha = shape * rev * hid * uAlpha;
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }`

// o "Íz" do topo: as letras são tinta; onde o cursor passou, a foto aparece por dentro delas
const HERO_FRAG = /* glsl */ `
  uniform sampler2D tMask, tTrail, tPhoto;
  uniform vec2 uSize; uniform float uRatio, uReveal, uHide, uTime;
  uniform vec3 uInk;
  varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  void main(){
    float m = texture2D(tMask, vUv).a;
    if (m < 0.002) discard;
    vec2 px = vUv * uSize;
    float g = n(px * 0.09) * 0.6 + n(px * 0.03) * 0.4;
    float tr = texture2D(tTrail, vUv).a * 2.2;
    float show = smoothstep(0.25, 0.55, tr + (g - 0.5) * 0.35);
    float boxRatio = uSize.x / uSize.y;
    vec2 sc = boxRatio > uRatio ? vec2(1.0, uRatio / boxRatio) : vec2(boxRatio / uRatio, 1.0);
    vec2 puv = (vUv - 0.5) * sc * 0.92 + 0.5;
    vec3 photo = texture2D(tPhoto, puv).rgb;
    vec3 col = mix(uInk, photo, show);
    float rev = smoothstep(-0.01, 0.01, uReveal * 1.12 - vUv.y - (g - 0.5) * 0.05);
    float hid = 1.0 - smoothstep(-0.01, 0.01, uHide * 1.12 - vUv.y - (g - 0.5) * 0.05);
    gl_FragColor = vec4(col, m * rev * hid);
    #include <colorspace_fragment>
  }`

export class HeroInk {
  mask = document.createElement('canvas')
  trail = document.createElement('canvas')
  tm: THREE.CanvasTexture
  tt: THREE.CanvasTexture
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  px = -999
  py = -999
  pad = 0
  constructor(private pics: Pics) {
    this.tm = new THREE.CanvasTexture(this.mask)
    this.tt = new THREE.CanvasTexture(this.trail)
    this.trail.width = 512
    this.trail.height = 256
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).translate(0.5, -0.5, 0),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: HERO_FRAG,
        transparent: true,
        depthTest: false,
        uniforms: {
          tMask: { value: this.tm },
          tTrail: { value: this.tt },
          tPhoto: { value: null },
          uSize: { value: new THREE.Vector2(1, 1) },
          uRatio: { value: 1 },
          uReveal: { value: 0 },
          uHide: { value: 0 },
          uTime: { value: 0 },
          uInk: { value: new THREE.Color(0x17130f) },
        },
      }),
    )
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.mesh.visible = false
    pics.scene.add(this.mesh)
  }

  // desenha o texto como máscara no tamanho exato do elemento
  setText(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio, 2)
    const cs = getComputedStyle(el)
    this.pad = r.height * 0.35
    this.mask.width = Math.max(1, Math.round(r.width * dpr))
    this.mask.height = Math.max(1, Math.round((r.height + this.pad * 2) * dpr))
    const c = this.mask.getContext('2d')!
    c.clearRect(0, 0, this.mask.width, this.mask.height)
    c.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * dpr}px ${cs.fontFamily}`
    c.letterSpacing = `${parseFloat(cs.letterSpacing || '0') * dpr}px`
    c.textBaseline = 'alphabetic'
    const t = el.textContent || ''
    const mt = c.measureText(t)
    const gh = mt.actualBoundingBoxAscent + mt.actualBoundingBoxDescent
    const y = (this.mask.height - gh) / 2 + mt.actualBoundingBoxAscent
    c.fillStyle = '#000'
    c.fillText(t, mt.actualBoundingBoxLeft, y)
    this.tm.needsUpdate = true
    this.trail.height = Math.max(64, Math.round((512 * (r.height + this.pad * 2)) / Math.max(1, r.width)))
  }

  update(x: number, y: number, w: number, h: number, mx: number, my: number, speed: number, photo: string, reveal: number, hide: number) {
    y -= this.pad
    h += this.pad * 2
    const tc = this.trail.getContext('2d')!
    tc.globalCompositeOperation = 'destination-out'
    tc.fillStyle = 'rgba(0,0,0,0.022)'
    tc.fillRect(0, 0, this.trail.width, this.trail.height)
    tc.globalCompositeOperation = 'source-over'
    const lx = ((mx - x) / w) * this.trail.width
    const ly = ((my - y) / h) * this.trail.height
    if (lx > -60 && ly > -60 && lx < this.trail.width + 60 && ly < this.trail.height + 60) {
      // pincel ao longo do caminho, mais largo quanto mais rápido
      const rad = 26 + Math.min(70, speed * 0.04)
      const steps = this.px < -900 ? 1 : Math.ceil(Math.hypot(lx - this.px, ly - this.py) / 6) || 1
      for (let i = 1; i <= steps; i++) {
        const sx = this.px < -900 ? lx : this.px + ((lx - this.px) * i) / steps
        const sy = this.py < -900 ? ly : this.py + ((ly - this.py) * i) / steps
        const g = tc.createRadialGradient(sx, sy, 0, sx, sy, rad)
        g.addColorStop(0, 'rgba(255,0,0,0.3)')
        g.addColorStop(1, 'rgba(255,0,0,0)')
        tc.fillStyle = g
        tc.fillRect(sx - rad, sy - rad, rad * 2, rad * 2)
      }
      this.px = lx
      this.py = ly
    } else {
      this.px = this.py = -999
    }
    this.tt.needsUpdate = true
    const P = this.pics.tex.get(photo)
    const u = this.mesh.material.uniforms
    if (P) {
      u.tPhoto.value = P.t
      u.uRatio.value = P.ratio
    }
    u.uSize.value.set(w, h)
    u.uReveal.value = reveal
    u.uHide.value = hide
    this.mesh.position.set(x, -y, 0)
    this.mesh.scale.set(w, h, 1)
    this.mesh.visible = reveal > 0 && hide < 1 && !!P
  }
}

export type Pic = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
}

export class Pics {
  r: THREE.WebGLRenderer
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10)
  tex = new Map<string, { t: THREE.Texture; ratio: number }>()
  pool: Pic[] = []
  used = 0
  w = 1
  h = 1
  time = 0
  vel = 0

  constructor(canvas: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false })
    this.r.setClearColor(0x000000, 0)
    this.resize()
  }

  resize() {
    this.w = innerWidth
    this.h = innerHeight
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.r.setSize(this.w, this.h, false)
    this.cam.right = this.w
    this.cam.bottom = -this.h
    this.cam.updateProjectionMatrix()
  }

  load(name: string) {
    return new Promise<void>((res) => {
      new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}img/${name}.webp`, (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.minFilter = THREE.LinearMipmapLinearFilter
        t.anisotropy = 4
        const img = t.image as HTMLImageElement
        this.tex.set(name, { t, ratio: img.width / img.height })
        res()
      }, undefined, () => res())
    })
  }

  private get(): Pic {
    if (this.used < this.pool.length) return this.pool[this.used++]
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).translate(0.5, -0.5, 0),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: false,
        uniforms: {
          tA: { value: null },
          tB: { value: null },
          uSize: { value: new THREE.Vector2(1, 1) },
          uRatioA: { value: 1 },
          uRatioB: { value: 1 },
          uRadius: { value: 6 },
          uReveal: { value: 1 },
          uHide: { value: 0 },
          uMix: { value: 0 },
          uZoom: { value: 1 },
          uVel: { value: 0 },
          uTime: { value: 0 },
          uAlpha: { value: 1 },
        },
      }),
    )
    mesh.frustumCulled = false
    this.scene.add(mesh)
    const p = { mesh }
    this.pool.push(p)
    this.used++
    return p
  }

  begin() {
    this.used = 0
  }

  draw(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { a: string; b?: string; mix?: number; reveal?: number; hide?: number; radius?: number; zoom?: number; alpha?: number; order?: number },
  ) {
    const A = this.tex.get(o.a)
    if (!A || w < 1 || h < 1) return
    const B = o.b ? this.tex.get(o.b) ?? A : A
    const p = this.get()
    const u = p.mesh.material.uniforms
    p.mesh.visible = true
    p.mesh.position.set(x, -y, 0)
    p.mesh.scale.set(w, h, 1)
    p.mesh.renderOrder = o.order ?? 0
    u.tA.value = A.t
    u.tB.value = B.t
    u.uRatioA.value = A.ratio
    u.uRatioB.value = B.ratio
    u.uSize.value.set(w, h)
    u.uRadius.value = o.radius ?? 6
    u.uReveal.value = o.reveal ?? 1
    u.uHide.value = o.hide ?? 0
    u.uMix.value = o.mix ?? 0
    u.uZoom.value = o.zoom ?? 1
    u.uVel.value = this.vel
    u.uTime.value = this.time
    u.uAlpha.value = o.alpha ?? 1
  }

  end() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].mesh.visible = false
    this.r.render(this.scene, this.cam)
  }
}
