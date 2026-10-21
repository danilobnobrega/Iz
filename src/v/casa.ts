import * as THREE from 'three'
import type { Frame } from './engine'
import { rt } from './post'
import { Label, type Overlay } from './type'
import { HOUSES } from './houses'
import type { Cloud } from './engrave'
import { cloudMaterial } from './vitrine'
import { clamp, damp, pad } from './util'

// A página de uma casa. Fundo escuro, um feixe de luz, poeira em suspensão, e a gravação livre do
// vidro, grande, que se afasta do cursor. O texto se decodifica e depois fica parado e legível.

export class Casa {
  rt = rt(2, 2, 4)
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  clouds: (THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null)[] = HOUSES.map(() => null)
  cur = -1
  w = 1
  h = 1
  beam: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  bokeh: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  L: { code: Label; name: Label; meta: Label; body: Label; visitK: Label; visit: Label; close: Label }
  ray = new THREE.Raycaster()
  mouse = new THREE.Vector3()
  rotY = 0
  rotX = 0
  inner = 0 // rolagem interna
  innerT = 0
  vis = 0
  open_ = false
  hoverLink = false
  hoverClose = false
  t0 = 0

  constructor(_r: THREE.WebGLRenderer, ov: Overlay) {
    this.scene.background = new THREE.Color(0x050404)
    this.cam.position.set(0, 0, 8)

    // feixe de luz diagonal
    this.beam = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 18),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uA: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uA; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
            return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          void main(){
            float x = abs(vUv.x - 0.5) * 2.0;
            float core = smoothstep(1.0, 0.0, x) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
            float dust = 0.75 + 0.25 * n(vUv * vec2(4.0, 30.0) + vec2(0.0, -uTime * 0.06));
            gl_FragColor = vec4(vec3(1.0, 0.85, 0.66) * core * core * dust * uA * 0.045, 1.0);
          }`,
      }),
    )
    this.beam.position.set(2.2, 1.5, -3)
    this.beam.rotation.z = 0.42
    this.scene.add(this.beam)

    // bokeh: poeira fora de foco
    const N = 260
    const p = new Float32Array(N * 3)
    const r = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      p.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, -4 + Math.random() * 9], i * 3)
      r[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('aR', new THREE.BufferAttribute(r, 1))
    this.bokeh = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uA: { value: 0 }, uDpr: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aR; uniform float uTime, uDpr; varying float vA; varying float vS;
          void main(){
            vec3 q = position;
            q.y += sin(uTime * 0.07 + aR * 30.0) * 0.4; q.x += cos(uTime * 0.05 + aR * 20.0) * 0.3;
            vec4 mv = modelViewMatrix * vec4(q, 1.0);
            float defocus = abs(-mv.z - 8.0);
            vS = defocus;
            gl_PointSize = (2.0 + defocus * 7.0) * uDpr;
            vA = (0.3 + aR * 0.7) / (1.0 + defocus * defocus * 0.6);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uA; varying float vA; varying float vS;
          void main(){ float d = length(gl_PointCoord - 0.5);
            float disk = smoothstep(0.5, 0.42, d) * (0.75 + 0.25 * smoothstep(0.3, 0.5, d));
            gl_FragColor = vec4(vec3(1.0, 0.82, 0.62) * disk * vA * uA * 0.25, 1.0); }`,
      }),
    )
    this.scene.add(this.bokeh)

    const o = { size: 10.5, spacing: 0.5, dur: 0.8 }
    this.L = {
      code: new Label(ov, '', { ...o, dur: 0.5 }),
      name: new Label(ov, '', { font: 'serif', size: 76, spacing: -1, lineHeight: 1.05, dur: 0.9, spread: 0.8 }),
      meta: new Label(ov, '', { ...o, lineHeight: 1.7 }),
      body: new Label(ov, '', { ...o, size: 12.5, spacing: 0.15, lineHeight: 1.75, maxWidth: 400, dur: 1.8, spread: 2.2 }),
      visitK: new Label(ov, '/// Como chegar', { ...o }),
      visit: new Label(ov, '[ Google Maps ↗ ]', { ...o, size: 11.5 }),
      close: new Label(ov, 'Fechar', { ...o, size: 11, align: 'center', dur: 0.4 }),
    }
  }

  setCloud(i: number, c: Cloud, y0: number) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(c.pos.subarray(0, c.count * 3), 3))
    g.setAttribute('aR', new THREE.BufferAttribute(c.rnd.subarray(0, c.count), 1))
    g.setAttribute('aL', new THREE.BufferAttribute(c.lum.subarray(0, c.count), 1))
    const m = cloudMaterial(c.h, 0)
    m.uniforms.uPush.value = 1
    const pts = new THREE.Points(g, m)
    pts.visible = false
    pts.frustumCulled = false
    pts.userData.y0 = y0
    this.scene.add(pts)
    this.clouds[i] = pts
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.rt.setSize(Math.round(w * dpr), Math.round(h * dpr))
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
    this.bokeh.material.uniforms.uDpr.value = dpr
    this.clouds.forEach((c) => c && (c.material.uniforms.uDpr.value = dpr))
  }

  open(i: number) {
    this.cur = i
    this.open_ = true
    this.inner = 0
    this.innerT = 0
    this.t0 = performance.now()
    this.clouds.forEach((c, k) => c && (c.visible = k === i))
    const h = HOUSES[i]
    const L = this.L
    L.code.set(`////// CASA_${pad(i + 1)} / ${pad(HOUSES.length)}`)
    L.name.set(h.name)
    L.meta.set(`${h.kind}\n${h.where}`)
    L.body.set(h.text)
    // destaca o nome da casa dentro do texto
    L.body.bold.clear()
    const idx = h.text.indexOf(h.name)
    if (idx >= 0) for (let k = 0; k < h.name.length; k++) L.body.bold.add(idx + k)
    L.code.show(true, 0.7)
    L.name.show(true, 0.8)
    L.meta.show(true, 1.0)
    L.body.show(true, 1.1)
    L.visitK.show(true, 1.5)
    L.visit.show(true, 1.6)
    L.close.show(true, 0.9)
  }

  closing() {
    this.open_ = false
    Object.values(this.L).forEach((l) => l.show(false))
  }

  hide() {
    if (this.open_) this.closing()
  }

  scroll(dy: number) {
    this.innerT = clamp(this.innerT + dy * 0.6, 0, Math.max(0, this.contentH() - this.h * 0.6))
  }

  contentH() {
    return this.L.name.height + this.L.meta.height + this.L.body.height + 220
  }

  update(f: Frame, mix: number) {
    const dt = f.dt
    const t = f.t
    this.vis = mix
    this.inner += (this.innerT - this.inner) * damp(0.1, dt)
    const mx = f.pointer.inside ? f.pointer.x : 0
    const my = f.pointer.inside ? f.pointer.y : 0
    this.rotY += (mx * 0.35 + Math.sin(t * 0.12) * 0.25 - this.rotY) * damp(0.04, dt)
    this.rotX += (-my * 0.18 - this.rotX) * damp(0.04, dt)
    const c = this.clouds[this.cur]
    const narrow = this.w < 820
    if (c) {
      const s = narrow ? 1.5 : 2.3
      c.position.set(narrow ? 0 : 1.6, (narrow ? 1.2 : 0) + this.inner * 0.004, 0)
      c.rotation.set(this.rotX, this.rotY - 0.25, 0)
      c.scale.setScalar(s)
      c.updateMatrix()
      const u = c.material.uniforms
      u.uTime.value = t
      u.uOpacity.value = 1.5 * clamp((performance.now() - this.t0) / 1400)
      u.uScale.value = 1.1
      this.ray.setFromCamera(new THREE.Vector2(mx, my), this.cam)
      this.mouse.lerp(this.ray.ray.origin, damp(0.3, dt))
      u.uMouse.value.copy(this.mouse)
      u.uMouseDir.value.lerp(this.ray.ray.direction, damp(0.3, dt))
      u.uPush.value += ((f.pointer.inside ? 1 : 0) - u.uPush.value) * damp(0.08, dt)
    }
    this.beam.material.uniforms.uTime.value = t
    this.beam.material.uniforms.uA.value = mix
    this.bokeh.material.uniforms.uTime.value = t
    this.bokeh.material.uniforms.uA.value = mix
    this.cam.position.x += (mx * 0.2 - this.cam.position.x) * damp(0.04, dt)
    this.cam.lookAt(0, 0, 0)

    // texto: coluna à esquerda
    const L = this.L
    const a = clamp((mix - 0.5) * 2)
    Object.values(L).forEach((l) => (l.alpha = a))
    const x = narrow ? 28 : Math.max(72, this.w * 0.09)
    let y = (narrow ? this.h * 0.42 : this.h * 0.24) - this.inner
    L.code.place(x, y)
    y += 34
    L.name.place(x - 4, y)
    y += L.name.height + 10
    L.meta.place(x, y)
    y += L.meta.height + 26
    if (narrow) L.body.o.maxWidth = this.w - 56
    L.body.place(x, y)
    y += L.body.height + 34
    L.visitK.place(x, y)
    y += 26
    L.visit.place(x, y)
    const p = f.pointer
    this.hoverLink = a > 0.9 && p.px > L.visit.x && p.px < L.visit.x + L.visit.width && p.py > L.visit.y && p.py < L.visit.y + L.visit.height
    // sublinhado do link
    if (L.visit.p > 0.9) {
      const uy = L.visit.y + L.visit.height - 3
      f.ov.lines.seg(L.visit.x + 4, uy, L.visit.x + L.visit.width - 4, uy, a * (this.hoverLink ? 0.9 : 0.35))
    }
    // fechar: canto superior direito, entre colchetes de mira
    const cx = this.w - 92
    const cy = 52
    L.close.place(cx, cy - 8)
    const bw = 44
    const bh = 20
    this.hoverClose = a > 0.9 && Math.abs(p.px - cx) < bw + 6 && Math.abs(p.py - cy) < bh + 6
    const k = this.hoverClose ? 5 : 0
    const ca = a * 0.9
    const corner = (sx: number, sy: number) => {
      const X = cx + sx * (bw + k)
      const Y = cy + sy * (bh + k * 0.5)
      f.ov.lines.seg(X, Y, X - sx * 8, Y, ca)
      f.ov.lines.seg(X, Y, X, Y - sy * 7, ca)
    }
    if (L.close.p > 0.2) {
      corner(-1, -1)
      corner(1, -1)
      corner(-1, 1)
      corner(1, 1)
    }
  }

  hover() {
    return this.hoverLink || this.hoverClose
  }

  click(f: Frame, close: () => void) {
    if (this.hoverClose) {
      close()
      return true
    }
    if (this.hoverLink) {
      window.open(HOUSES[this.cur].maps, '_blank', 'noopener')
      f.sound.beep(0)
      return true
    }
    return false
  }

  render(r: THREE.WebGLRenderer, _f: Frame) {
    r.setRenderTarget(this.rt)
    r.render(this.scene, this.cam)
  }
}
