import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from '../y/core'

// "Fulles Kitchen, na lenha": fumaça e brasas. 65 mil partículas na GPU nascem sobre a brasa,
// sobem por empuxo e se enrolam num campo de redemoinho (curl noise); as mais quentes são fagulhas
// laranja que piscam e apagam. A fumaça é clara onde a brasa ilumina e acinzenta ao subir.
// O cursor é uma corrente de ar que desvia tudo.

const VEL = /* glsl */ `
  uniform float uDt, uTime, uWindOn; uniform vec2 uWind, uMouse;
  vec3 h33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx) - 0.5; }
  float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(mix(dot(h33(i), f), dot(h33(i+vec3(1,0,0)), f-vec3(1,0,0)), f.x), mix(dot(h33(i+vec3(0,1,0)), f-vec3(0,1,0)), dot(h33(i+vec3(1,1,0)), f-vec3(1,1,0)), f.x), f.y),
               mix(mix(dot(h33(i+vec3(0,0,1)), f-vec3(0,0,1)), dot(h33(i+vec3(1,0,1)), f-vec3(1,0,1)), f.x), mix(dot(h33(i+vec3(0,1,1)), f-vec3(0,1,1)), dot(h33(i+vec3(1,1,1)), f-vec3(1,1,1)), f.x), f.y), f.z); }
  vec2 curl(vec2 p, float t){ float e = 0.05;
    float a = n3(vec3(p + vec2(0, e), t)), b = n3(vec3(p - vec2(0, e), t));
    float c = n3(vec3(p + vec2(e, 0), t)), d = n3(vec3(p - vec2(e, 0), t));
    return vec2(a - b, -(c - d)) / (2.0 * e); }
  void main(){
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 p = texture2D(tPos, uv); vec4 v = texture2D(tVel, uv);
    vec2 acc = vec2(0.0, 0.55 + p.w * 0.4);
    acc += curl(p.xy * 1.3, uTime * 0.15) * 1.6 + curl(p.xy * 3.5, uTime * 0.3) * 0.6;
    vec2 d = p.xy - uMouse;
    acc += uWind * exp(-dot(d, d) / 0.25) * uWindOn * 3.0;
    v.xy += acc * uDt;
    v.xy *= pow(0.4, uDt);
    gl_FragColor = v;
  }`
const POS = /* glsl */ `
  uniform float uDt, uTime;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 p = texture2D(tPos, uv); vec4 v = texture2D(tVel, uv);
    p.xy += v.xy * uDt;
    p.z += uDt * (0.18 + h(uv) * 0.2); // idade
    if (p.z > 1.0 || p.y > 2.4) {
      float r = h(uv + uTime);
      p = vec4((r - 0.5) * 2.6, -1.25 + h(uv * 3.1 + uTime) * 0.1, 0.0, p.w);
    }
    gl_FragColor = p;
  }`

export class SmokeSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
  gpu!: GPUComputationRenderer
  vPos!: Variable
  vVel!: Variable
  points!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  bed: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  S = 256
  lastM = new THREE.Vector2()
  wind = new THREE.Vector2()

  constructor(el: HTMLElement) {
    super(el)
    this.scene.background = new THREE.Color('#050404')
    // brasa no pé da tela
    this.bed = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        depthTest: false,
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uAsp: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uTime, uOn, uAsp; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
            return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          void main(){
            float y = vUv.y;
            float glow = exp(-y * 9.0);
            float coal = n(vec2(vUv.x * 30.0 * uAsp, y * 30.0) + vec2(0.0, uTime * 0.3)) * n(vec2(vUv.x * 9.0 * uAsp, uTime * 0.5));
            vec3 c = vec3(1.0, 0.35, 0.06) * glow * (0.4 + coal * 1.5) + vec3(1.0, 0.6, 0.2) * exp(-y * 40.0) * coal * 2.0;
            gl_FragColor = vec4(c * uOn, 1.0);
          }`,
        blending: THREE.AdditiveBlending,
        transparent: true,
      }),
    )
    this.bed.frustumCulled = false
    this.bed.renderOrder = -1
    this.scene.add(this.bed)
  }

  async init(r: THREE.WebGLRenderer) {
    const S = this.S
    this.gpu = new GPUComputationRenderer(S, S, r)
    const p0 = this.gpu.createTexture()
    for (let i = 0; i < S * S; i++) p0.image.data!.set([(Math.random() - 0.5) * 2.6, -1.25 + Math.random() * 3.4, Math.random(), Math.random()], i * 4)
    this.vPos = this.gpu.addVariable('tPos', POS, p0)
    this.vVel = this.gpu.addVariable('tVel', VEL, this.gpu.createTexture())
    this.gpu.setVariableDependencies(this.vPos, [this.vPos, this.vVel])
    this.gpu.setVariableDependencies(this.vVel, [this.vPos, this.vVel])
    Object.assign(this.vVel.material.uniforms, { uDt: { value: 1 / 60 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uMouse: { value: new THREE.Vector2(9, 9) }, uWindOn: { value: 0 } })
    Object.assign(this.vPos.material.uniforms, { uDt: { value: 1 / 60 }, uTime: { value: 0 } })
    this.gpu.init()
    const ref = new Float32Array(S * S * 2)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) ref.set([(x + 0.5) / S, (y + 0.5) / S], (y * S + x) * 2)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * S * 3), 3))
    g.setAttribute('aRef', new THREE.BufferAttribute(ref, 2))
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { tPos: { value: null }, uDpr: { value: 1 }, uH: { value: 900 }, uTime: { value: 0 }, uOn: { value: 0 } },
        vertexShader: /* glsl */ `attribute vec2 aRef; uniform sampler2D tPos; uniform float uDpr, uH, uTime;
          varying float vAge; varying float vSpark; varying float vY; varying float vFl;
          void main(){ vec4 p = texture2D(tPos, aRef); vAge = p.z; vY = p.y; vSpark = step(0.95, p.w);
            vFl = 0.6 + 0.4 * sin(uTime * 30.0 + p.w * 100.0);
            float size = vSpark > 0.5 ? 2.2 : (6.0 + p.z * 34.0);
            gl_PointSize = size * uH / 900.0 * uDpr;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uOn; varying float vAge; varying float vSpark; varying float vY; varying float vFl;
          void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
            if (vSpark > 0.5) { float a = smoothstep(0.5, 0.0, d) * (1.0 - vAge) * vFl; gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * a * 2.5 * uOn, 1.0); return; }
            float a = smoothstep(0.5, 0.0, d) * sin(3.14159 * vAge) * 0.022;
            // perto da brasa a fumaça é iluminada de laranja; no alto, cinza
            vec3 c = mix(vec3(1.0, 0.55, 0.25), vec3(0.55, 0.55, 0.58), smoothstep(-1.2, 0.2, vY));
            gl_FragColor = vec4(c * a * uOn, 1.0); }`,
      }),
    )
    this.points.frustumCulled = false
    this.scene.add(this.points)
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const a = w / h
    this.cam.left = -a * 1.25
    this.cam.right = a * 1.25
    this.cam.top = 1.25
    this.cam.bottom = -1.25
    this.cam.updateProjectionMatrix()
    if (this.points) {
      this.points.material.uniforms.uDpr.value = dpr
      this.points.material.uniforms.uH.value = h
    }
    this.bed.material.uniforms.uAsp.value = a
  }

  update(p: number, c: Ctx, rect: Rect) {
    const on = ease(fit(p, 0, 0.12)) * (1 - ease(fit(p, 0.92, 1)))
    const dt = Math.min(c.dt, 1 / 30)
    const vu = this.vVel.material.uniforms
    vu.uDt.value = dt
    vu.uTime.value = c.t
    this.vPos.material.uniforms.uDt.value = dt
    this.vPos.material.uniforms.uTime.value = c.t
    const m = this.local(c, rect)
    const mx = m.x * this.cam.right, my = m.y * this.cam.top
    const v = new THREE.Vector2(mx - this.lastM.x, my - this.lastM.y).divideScalar(Math.max(c.dt, 1e-3))
    this.lastM.set(mx, my)
    this.wind.lerp(v.clampLength(0, 6), damp(0.2, c.dt))
    vu.uWind.value.copy(this.wind)
    vu.uMouse.value.set(mx, my)
    vu.uWindOn.value = m.inside ? 1 : 0
    this.gpu.compute()
    this.points.material.uniforms.tPos.value = this.gpu.getCurrentRenderTarget(this.vPos).texture
    this.points.material.uniforms.uTime.value = c.t
    this.points.material.uniforms.uOn.value = on
    this.bed.material.uniforms.uTime.value = c.t
    this.bed.material.uniforms.uOn.value = on
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
