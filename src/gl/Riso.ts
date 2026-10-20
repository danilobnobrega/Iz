import * as THREE from 'three'

// Proposta R — "Prensa". Cada foto é impressa por um shader de retícula em duas tintas
// (chapa de sombra + chapa de cor), sobrepostas por multiplicação sobre papel.
// Controles por impressão: registro (deslocamento entre as chapas), crescimento dos pontos,
// ângulo da retícula, passada do rolo (troca de imagem/tintas) e a lupa do cursor.

THREE.ColorManagement.enabled = false

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uAspA;
  uniform float uAspB;
  uniform vec2 uSize;
  uniform vec3 uPaper;
  uniform vec3 uInkA1; uniform vec3 uInkB1; // tintas da imagem A
  uniform vec3 uInkA2; uniform vec3 uInkB2; // tintas da imagem B
  uniform float uCell;
  uniform float uAngle;
  uniform vec2 uOffA;
  uniform vec2 uOffB;
  uniform float uGrow;
  uniform float uSweep; // 0 = só A, 1 = só B
  uniform vec2 uMouse;  // em px do plano
  uniform float uLoupe;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  vec3 sampleImg(sampler2D t, float asp, vec2 px) {
    vec2 uv = px / uSize;
    float ra = uSize.x / uSize.y;
    vec2 s = ra > asp ? vec2(1.0, asp / ra) : vec2(ra / asp, 1.0);
    uv = (uv - 0.5) * s + 0.5;
    uv.y = 1.0 - uv.y;
    return texture2D(t, clamp(uv, 0.001, 0.999)).rgb;
  }

  // separações: chapa de sombra (escuros) e chapa de cor (quentes e meios-tons)
  vec2 tones(vec3 c) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float shadow = pow(clamp(1.0 - l * 1.18, 0.0, 1.0), 1.25);
    float warm = clamp((c.r - c.b) * 1.6 + (1.0 - l) * 0.45 - 0.08, 0.0, 1.0);
    return vec2(shadow, warm);
  }

  // um ponto da retícula: amostra a imagem no centro da célula e desenha um círculo
  float plate(sampler2D t, float asp, vec2 px, vec2 off, float ang, float cell, int which) {
    vec2 p = rot(ang) * (px - off);
    vec2 cc = (floor(p / cell) + 0.5) * cell;
    vec2 center = rot(-ang) * cc + off;
    vec2 tn = tones(sampleImg(t, asp, center));
    float tone = which == 0 ? tn.x : tn.y;
    float r = sqrt(tone) * cell * 0.66 * uGrow;
    float d = length(p - cc);
    float aa = 0.8;
    return smoothstep(r + aa, r - aa, d);
  }

  vec3 print(sampler2D t, float asp, vec2 px, vec3 inkA, vec3 inkB, float cell) {
    float a = plate(t, asp, px, uOffA, uAngle + 0.2618, cell, 0);       // 15°
    float b = plate(t, asp, px, uOffB, uAngle + 1.3090, cell * 1.06, 1); // 75°
    // tinta de riso: multiplica, com densidade irregular
    float dens = 0.88 + hash(floor(px * 0.5)) * 0.12;
    vec3 col = uPaper;
    col *= mix(vec3(1.0), inkB, b * dens);
    col *= mix(vec3(1.0), inkA, a * dens);
    return col;
  }

  void main() {
    vec2 px = vUv * uSize;
    px.y = uSize.y - px.y;
    float cell = uCell;
    // lupa: dentro do círculo do cursor, a retícula aparece ampliada
    float md = distance(px, uMouse);
    float inL = (1.0 - smoothstep(uLoupe - 1.5, uLoupe + 1.5, md)) * step(1.0, uLoupe);
    vec2 q = mix(px, uMouse + (px - uMouse) / 2.6, inL);

    // passada do rolo: a fronteira é irregular e deixa uma faixa de tinta
    float edge = uSweep * (uSize.y + 160.0) - 80.0 + (hash(vec2(floor(px.x / 6.0), 1.0)) - 0.5) * 18.0 + sin(px.x * 0.02 + uTime) * 6.0;
    float showB = step(px.y, edge);
    vec3 cA = print(tA, uAspA, q, uInkA1, uInkB1, cell);
    vec3 cB = print(tB, uAspB, q, uInkA2, uInkB2, cell);
    vec3 col = mix(cA, cB, showB);
    // faixa do rolo: tinta acumulada na borda da passada
    float band = smoothstep(14.0, 0.0, abs(px.y - edge)) * step(0.001, uSweep) * step(uSweep, 0.999);
    col *= mix(vec3(1.0), uInkB2, band * 0.55);

    // fibra do papel
    float fib = hash(floor(px * vec2(0.6, 2.2)));
    col *= 0.97 + fib * 0.03;
    // aro da lupa
    float ring = smoothstep(1.5, 0.0, abs(md - uLoupe)) * step(1.0, uLoupe);
    col = mix(col, uInkA1, ring * 0.8);
    gl_FragColor = vec4(col, 1.0);
  }
`

export type Inks = [string, string]

export class Print {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  reg = 0 // 0 = registrado, 1 = desencontrado
  grow = 1
  angle = 0
  sweep = 0
  loupe = 0
  private regDir = new THREE.Vector2(1, -0.6)

  constructor(public el: HTMLElement, a: THREE.Texture, inks: Inks, paper: THREE.Color, geo: THREE.PlaneGeometry) {
    const asp = (t: THREE.Texture) => (t.image as HTMLImageElement).width / (t.image as HTMLImageElement).height
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          tA: { value: a },
          tB: { value: a },
          uAspA: { value: asp(a) },
          uAspB: { value: asp(a) },
          uSize: { value: new THREE.Vector2(1, 1) },
          uPaper: { value: paper },
          uInkA1: { value: new THREE.Color(inks[0]) },
          uInkB1: { value: new THREE.Color(inks[1]) },
          uInkA2: { value: new THREE.Color(inks[0]) },
          uInkB2: { value: new THREE.Color(inks[1]) },
          uCell: { value: 7 },
          uAngle: { value: 0 },
          uOffA: { value: new THREE.Vector2() },
          uOffB: { value: new THREE.Vector2() },
          uGrow: { value: 1 },
          uSweep: { value: 0 },
          uMouse: { value: new THREE.Vector2(-999, -999) },
          uLoupe: { value: 0 },
          uTime: { value: 0 },
        },
      }),
    )
    this.mesh.frustumCulled = false
  }

  // começa uma passada: a imagem atual vira A, a nova vira B
  setNext(t: THREE.Texture, inks: Inks) {
    const u = this.mesh.material.uniforms
    u.tB.value = t
    u.uAspB.value = (t.image as HTMLImageElement).width / (t.image as HTMLImageElement).height
    u.uInkA2.value.set(inks[0])
    u.uInkB2.value.set(inks[1])
  }
  // termina a passada: B vira A
  commit() {
    const u = this.mesh.material.uniforms
    u.tA.value = u.tB.value
    u.uAspA.value = u.uAspB.value
    u.uInkA1.value.copy(u.uInkA2.value)
    u.uInkB1.value.copy(u.uInkB2.value)
    this.sweep = 0
  }

  update(W: number, H: number, mx: number, my: number, t: number) {
    const r = this.el.getBoundingClientRect()
    const vis = r.bottom > 0 && r.top < H && r.right > 0 && r.left < W
    this.mesh.visible = vis
    if (!vis) return
    this.mesh.position.set(r.left + r.width / 2 - W / 2, H / 2 - (r.top + r.height / 2), 0)
    this.mesh.scale.set(r.width, r.height, 1)
    const u = this.mesh.material.uniforms
    u.uSize.value.set(r.width, r.height)
    u.uCell.value = Math.max(5, Math.min(9, r.width / 120))
    const off = this.regDir.clone().multiplyScalar(this.reg * 26)
    u.uOffA.value.copy(off)
    u.uOffB.value.copy(off.clone().multiplyScalar(-1))
    u.uGrow.value = this.grow
    u.uAngle.value = this.angle
    u.uSweep.value = this.sweep
    u.uMouse.value.set(mx - r.left, my - r.top)
    u.uLoupe.value = this.loupe
    u.uTime.value = t
  }
}

export class Press {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  prints: Print[] = []
  paper: THREE.Color
  geo = new THREE.PlaneGeometry(1, 1)
  private loader = new THREE.TextureLoader()
  private clock = new THREE.Clock()
  W = 1
  H = 1

  constructor(canvas: HTMLCanvasElement, paper: string) {
    this.paper = new THREE.Color(paper)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.resize()
  }

  async texture(src: string) {
    const t = await this.loader.loadAsync(src)
    t.colorSpace = THREE.NoColorSpace
    t.minFilter = THREE.LinearFilter
    return t
  }

  async add(el: HTMLElement, src: string, inks: Inks) {
    const p = new Print(el, await this.texture(src), inks, this.paper, this.geo)
    this.prints.push(p)
    this.scene.add(p.mesh)
    el.classList.add('is-gl')
    return p
  }

  resize() {
    this.W = window.innerWidth
    this.H = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.W, this.H, false)
    this.camera.left = -this.W / 2
    this.camera.right = this.W / 2
    this.camera.top = this.H / 2
    this.camera.bottom = -this.H / 2
    this.camera.updateProjectionMatrix()
  }

  render(mx: number, my: number) {
    const t = this.clock.getElapsedTime()
    for (const p of this.prints) p.update(this.W, this.H, mx, my, t)
    this.renderer.render(this.scene, this.camera)
  }
}
