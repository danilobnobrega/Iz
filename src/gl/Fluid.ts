import * as THREE from 'three'

// Simulação de fluido incompressível na GPU (advecção semi-lagrangiana, vorticidade,
// projeção por pressão com Jacobi). Mantém dois campos: velocidade e uma "tinta" escalar.
// Baseado no método de Jos Stam ("Stable Fluids"), como popularizado por Pavel Dobryakov.

THREE.ColorManagement.enabled = false

const baseVert = /* glsl */ `
  uniform vec2 texelSize;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  void main() {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const head = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
`

const splatFrag = head + /* glsl */ `
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main() {
    vec2 p = vUv - point;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`

// a tinta é limitada a [0,1]: é uma máscara de revelação
const splatClampFrag = head + /* glsl */ `
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main() {
    vec2 p = vUv - point;
    p.x *= aspectRatio;
    float splat = exp(-dot(p, p) / radius) * color.x;
    float base = texture2D(uTarget, vUv).x;
    gl_FragColor = vec4(min(base + splat, 1.0), 0.0, 0.0, 1.0);
  }
`

const advectionFrag = head + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform float dt;
  uniform float dissipation;
  void main() {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`

const divergenceFrag = head + /* glsl */ `
  uniform sampler2D uVelocity;
  void main() {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`

const curlFrag = head + /* glsl */ `
  uniform sampler2D uVelocity;
  void main() {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`

const vorticityFrag = head + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  void main() {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`

const pressureFrag = head + /* glsl */ `
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`

const gradientFrag = head + /* glsl */ `
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`

const scaleFrag = head + /* glsl */ `
  uniform sampler2D uTexture;
  uniform float value;
  uniform float add;
  void main() {
    gl_FragColor = vec4(min(texture2D(uTexture, vUv).xyz * value + add, vec3(1.0)), 1.0);
  }
`

class DoubleFBO {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
  constructor(w: number, h: number, opts: THREE.RenderTargetOptions) {
    this.read = new THREE.WebGLRenderTarget(w, h, opts)
    this.write = new THREE.WebGLRenderTarget(w, h, opts)
  }
  swap() {
    ;[this.read, this.write] = [this.write, this.read]
  }
  dispose() {
    this.read.dispose()
    this.write.dispose()
  }
}

export type FluidConfig = {
  simRes: number
  dyeRes: number
  velocityDissipation: number
  dyeDissipation: number
  pressureIterations: number
  curl: number
}

export class Fluid {
  velocity!: DoubleFBO
  dye!: DoubleFBO
  private pressure!: DoubleFBO
  private divergence!: THREE.WebGLRenderTarget
  private curlRT!: THREE.WebGLRenderTarget
  private simTexel = new THREE.Vector2()
  private dyeTexel = new THREE.Vector2()
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: THREE.Mesh
  private mats: Record<string, THREE.ShaderMaterial> = {}
  aspect = 1

  constructor(private renderer: THREE.WebGLRenderer, public cfg: FluidConfig) {
    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: baseVert, fragmentShader: frag, uniforms: { texelSize: { value: new THREE.Vector2() }, ...uniforms }, depthTest: false, depthWrite: false })
    this.mats.splat = mk(splatFrag, { uTarget: { value: null }, aspectRatio: { value: 1 }, color: { value: new THREE.Vector3() }, point: { value: new THREE.Vector2() }, radius: { value: 0.001 } })
    this.mats.splatClamp = mk(splatClampFrag, { uTarget: { value: null }, aspectRatio: { value: 1 }, color: { value: new THREE.Vector3() }, point: { value: new THREE.Vector2() }, radius: { value: 0.001 } })
    this.mats.advection = mk(advectionFrag, { uVelocity: { value: null }, uSource: { value: null }, dt: { value: 0 }, dissipation: { value: 0 } })
    this.mats.divergence = mk(divergenceFrag, { uVelocity: { value: null } })
    this.mats.curl = mk(curlFrag, { uVelocity: { value: null } })
    this.mats.vorticity = mk(vorticityFrag, { uVelocity: { value: null }, uCurl: { value: null }, curl: { value: 0 }, dt: { value: 0 } })
    this.mats.pressure = mk(pressureFrag, { uPressure: { value: null }, uDivergence: { value: null } })
    this.mats.gradient = mk(gradientFrag, { uPressure: { value: null }, uVelocity: { value: null } })
    this.mats.scale = mk(scaleFrag, { uTexture: { value: null }, value: { value: 1 }, add: { value: 0 } })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mats.splat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  resize(w: number, h: number) {
    this.aspect = w / h
    const res = (r: number) => (w > h ? { w: Math.round(r * this.aspect), h: r } : { w: r, h: Math.round(r / this.aspect) })
    const sim = res(this.cfg.simRes)
    const dye = res(this.cfg.dyeRes)
    const opts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }
    const near: THREE.RenderTargetOptions = { ...opts, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }
    this.velocity?.dispose()
    this.dye?.dispose()
    this.pressure?.dispose()
    this.divergence?.dispose()
    this.curlRT?.dispose()
    this.velocity = new DoubleFBO(sim.w, sim.h, opts)
    this.dye = new DoubleFBO(dye.w, dye.h, opts)
    this.pressure = new DoubleFBO(sim.w, sim.h, near)
    this.divergence = new THREE.WebGLRenderTarget(sim.w, sim.h, near)
    this.curlRT = new THREE.WebGLRenderTarget(sim.w, sim.h, near)
    this.simTexel.set(1 / sim.w, 1 / sim.h)
    this.dyeTexel.set(1 / dye.w, 1 / dye.h)
    this.clearDye(0)
  }

  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget, texel: THREE.Vector2) {
    mat.uniforms.texelSize.value.copy(texel)
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  // força no ponto (uv 0..1), em pixels de simulação por segundo
  splatVelocity(x: number, y: number, dx: number, dy: number, radius = 0.0025) {
    const m = this.mats.splat
    m.uniforms.uTarget.value = this.velocity.read.texture
    m.uniforms.aspectRatio.value = this.aspect
    m.uniforms.point.value.set(x, y)
    m.uniforms.color.value.set(dx, dy, 0)
    m.uniforms.radius.value = radius
    this.blit(m, this.velocity.write, this.simTexel)
    this.velocity.swap()
  }

  splatDye(x: number, y: number, amount: number, radius = 0.003) {
    const m = this.mats.splatClamp
    m.uniforms.uTarget.value = this.dye.read.texture
    m.uniforms.aspectRatio.value = this.aspect
    m.uniforms.point.value.set(x, y)
    m.uniforms.color.value.set(amount, 0, 0)
    m.uniforms.radius.value = radius
    this.blit(m, this.dye.write, this.dyeTexel)
    this.dye.swap()
  }

  // multiplica a tinta e soma um valor uniforme (usado pra completar a revelação)
  scaleDye(value: number, add = 0) {
    const m = this.mats.scale
    m.uniforms.uTexture.value = this.dye.read.texture
    m.uniforms.value.value = value
    m.uniforms.add.value = add
    this.blit(m, this.dye.write, this.dyeTexel)
    this.dye.swap()
  }

  clearDye(v: number) {
    this.scaleDye(0, v)
  }

  step(dt: number) {
    const { mats: m, simTexel } = this
    m.curl.uniforms.uVelocity.value = this.velocity.read.texture
    this.blit(m.curl, this.curlRT, simTexel)

    m.vorticity.uniforms.uVelocity.value = this.velocity.read.texture
    m.vorticity.uniforms.uCurl.value = this.curlRT.texture
    m.vorticity.uniforms.curl.value = this.cfg.curl
    m.vorticity.uniforms.dt.value = dt
    this.blit(m.vorticity, this.velocity.write, simTexel)
    this.velocity.swap()

    m.divergence.uniforms.uVelocity.value = this.velocity.read.texture
    this.blit(m.divergence, this.divergence, simTexel)

    // pressão começa da anterior atenuada
    m.scale.uniforms.uTexture.value = this.pressure.read.texture
    m.scale.uniforms.value.value = 0.8
    m.scale.uniforms.add.value = 0
    this.blit(m.scale, this.pressure.write, simTexel)
    this.pressure.swap()

    m.pressure.uniforms.uDivergence.value = this.divergence.texture
    for (let i = 0; i < this.cfg.pressureIterations; i++) {
      m.pressure.uniforms.uPressure.value = this.pressure.read.texture
      this.blit(m.pressure, this.pressure.write, simTexel)
      this.pressure.swap()
    }

    m.gradient.uniforms.uPressure.value = this.pressure.read.texture
    m.gradient.uniforms.uVelocity.value = this.velocity.read.texture
    this.blit(m.gradient, this.velocity.write, simTexel)
    this.velocity.swap()

    m.advection.uniforms.uVelocity.value = this.velocity.read.texture
    m.advection.uniforms.uSource.value = this.velocity.read.texture
    m.advection.uniforms.dt.value = dt
    m.advection.uniforms.dissipation.value = this.cfg.velocityDissipation
    this.blit(m.advection, this.velocity.write, simTexel)
    this.velocity.swap()

    m.advection.uniforms.uVelocity.value = this.velocity.read.texture
    m.advection.uniforms.uSource.value = this.dye.read.texture
    m.advection.uniforms.dissipation.value = this.cfg.dyeDissipation
    // a tinta anda com a velocidade medida em texels da simulação
    this.blit(m.advection, this.dye.write, simTexel)
    this.dye.swap()
  }
}
