import * as THREE from 'three'
import { PORCELANA_FRAG } from '../gl/Porcelana'
import { wordAtlasExact } from '../gl/wordSdfExact'
import { BASE } from '../gl/wordSdf'
import fontUrl from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff?url'
import { Section, Quad, FS_VERT, clamp, damp, ease, fit, type Ctx, type Rect } from './core'

// Abertura e fechamento: o nome em porcelana, calculado pixel a pixel. Na abertura a palavra
// afunda no piso conforme se rola; no fechamento, "520" sobe de dentro do piso.

export class PorcelainSec extends Section {
  mat!: THREE.ShaderMaterial
  blend!: THREE.ShaderMaterial
  copy!: THREE.ShaderMaterial
  quad = new Quad()
  rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false })
  acc = [0, 1].map(() => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false }))
  accI = 0
  n = 0
  cam = new THREE.Vector3(0, 0.05, 6)
  tgt = new THREE.Vector3()
  light = new THREE.Vector3(-0.55, 0.75, 0.55)
  press = new THREE.Vector4()
  last = new THREE.Vector3()
  lastP = 0
  fresh = 1

  constructor(el: HTMLElement, private word: string, private mode: 'sink' | 'rise') {
    super(el)
  }

  async init(r: THREE.WebGLRenderer) {
    const atlas = await wordAtlasExact(r, [this.word], fontUrl, 1024, 400)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: PORCELANA_FRAG,
      depthTest: false,
      uniforms: {
        tSdf: { value: atlas.texture },
        uCount: { value: 1 },
        uTexW: { value: 1024 },
        uCellH: { value: 400 },
        uAspect: { value: atlas.aspect },
        uA: { value: 0 },
        uB: { value: 0 },
        uMix: { value: 0 },
        uTime: { value: 0 },
        uH: { value: 2.4 },
        uDepth: { value: 0.22 },
        uRound: { value: 0.045 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCamPos: { value: new THREE.Vector3() },
        uCamTarget: { value: new THREE.Vector3() },
        uLight: { value: new THREE.Vector3() },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uFov: { value: 30 },
        uRoll: { value: 0 },
        uPress: { value: new THREE.Vector4() },
        uFloorY: { value: (0.5 - BASE) * 2.4 },
        uDebug: { value: 0 },
        uJitter: { value: new THREE.Vector2() },
      },
    })
    // a mistura uMix aqui só afunda/sobe a palavra única (A = B)
    this.blend = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: `uniform sampler2D tCur, tPrev; uniform float uAlpha; varying vec2 vUv;
        void main(){ gl_FragColor = vec4(mix(texture2D(tPrev, vUv).rgb, texture2D(tCur, vUv).rgb, uAlpha), 1.0); }`,
      depthTest: false,
      uniforms: { tCur: { value: null }, tPrev: { value: null }, uAlpha: { value: 1 } },
    })
    this.copy = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }`,
      depthTest: false,
      uniforms: { t: { value: null } },
    })
  }

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    const d = Math.min(dpr, 1.5)
    const W = Math.round(w * d)
    const H = Math.round(h * d)
    this.rt.setSize(W, H)
    this.acc.forEach((a) => a.setSize(W, H))
    if (this.mat) this.mat.uniforms.uRes.value.set(W, H)
    this.fresh = 1
  }

  update(p: number, c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    const m = this.local(c, rect)
    const narrow = this.w / this.h < 1
    // afundar: a palavra só desce na segunda metade; subir: ela sobe logo no começo
    const s = this.mode === 'sink' ? ease(fit(p, 0.45, 0.95)) : 1 - ease(fit(p, 0.05, 0.5))
    // o "mix" do shader afunda a palavra A; a B é a mesma e fica escondida no piso
    u.uMix.value = 0
    u.uA.value = 0
    u.uB.value = 0
    ;(u.uFloorY.value as number) = (0.5 - BASE) * 2.4
    u.uTime.value = c.t
    const dist = narrow ? 6 / Math.max(0.5, this.w / this.h) * 0.62 : 6
    const ang = this.mode === 'sink' ? -0.25 + p * 0.35 : 0.3 - p * 0.3
    const camT = new THREE.Vector3(Math.sin(ang) * dist + m.x * 0.35, 0.05 + p * 0.6 + m.y * 0.2, Math.cos(ang) * dist)
    this.cam.lerp(camT, damp(0.12, c.dt))
    this.tgt.set(0, -0.05 - s * 0.6, 0)
    const L = new THREE.Vector3(-0.55 + m.x * 0.9, 0.75 + m.y * 0.45, 0.55).normalize()
    this.light.lerp(L, damp(0.08, c.dt))
    u.uCamPos.value.copy(this.cam)
    u.uCamTarget.value.copy(this.tgt)
    u.uLight.value.copy(this.light)
    // afunda empurrando o piso: usa o uniforme de pressão como "nível" da palavra
    u.uRound.value = 0.045
    this.sink = s
    // dedo do cursor na face da frente
    const want = m.inside ? (c.ptr.down ? 1.6 : 0.55) : 0
    this.press.w += (want - this.press.w) * damp(c.ptr.down ? 0.12 : 0.05, c.dt)
    const ww = this.tgt.clone().sub(this.cam).normalize()
    const uu = ww.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
    const vv = uu.clone().cross(ww)
    const fl = 1 / Math.tan(THREE.MathUtils.degToRad(30) / 2)
    const rd = uu.multiplyScalar(m.x * (rect.w / rect.h)).add(vv.multiplyScalar(m.y)).add(ww.multiplyScalar(fl)).normalize()
    const tz = (0.22 - this.cam.z) / rd.z
    const hit = this.cam.clone().add(rd.multiplyScalar(tz))
    this.press.x += (hit.x - this.press.x) * damp(0.25, c.dt)
    this.press.y += (hit.y - this.press.y) * damp(0.25, c.dt)
    this.press.z = 0.22
    u.uPress.value.copy(this.press)
  }
  sink = 0

  render(c: Ctx, rect: Rect) {
    const u = this.mat.uniforms
    // a palavra afunda: desloca o piso para cima é o mesmo que descer a palavra
    u.uFloorY.value = (0.5 - BASE) * 2.4 + this.sink * 2.9
    u.uCamPos.value.y += this.sink * 2.9
    u.uCamTarget.value.y += this.sink * 2.9
    this.n++
    const halton = (i: number, b: number) => {
      let f = 1, r = 0
      while (i > 0) {
        f /= b
        r += f * (i % b)
        i = Math.floor(i / b)
      }
      return r
    }
    const k = (this.n % 16) + 1
    u.uJitter.value.set(halton(k, 2) - 0.5, halton(k, 3) - 0.5)
    const moved = this.cam.distanceTo(this.last) * 30 + Math.abs(this.sink - this.lastP) * 40
    this.last.copy(this.cam)
    this.lastP = this.sink
    this.quad.draw(c.r, this.mat, this.rt)
    const prev = this.acc[this.accI]
    const next = this.acc[1 - this.accI]
    this.blend.uniforms.tCur.value = this.rt.texture
    this.blend.uniforms.tPrev.value = prev.texture
    this.blend.uniforms.uAlpha.value = Math.max(this.fresh, clamp(0.12 + moved, 0.12, 1))
    this.fresh = 0
    this.quad.draw(c.r, this.blend, next)
    this.accI = 1 - this.accI
    this.copy.uniforms.t.value = next.texture
    this.quad.screen(c, rect, this.copy)
  }
}
