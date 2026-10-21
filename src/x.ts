import '@fontsource-variable/jetbrains-mono'
import '@fontsource/instrument-serif'
import './x.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { BASE } from './gl/wordSdf'
import { wordAtlasExact } from './gl/wordSdfExact'
import fontUrl from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff?url'
import { Porcelana } from './gl/Porcelana'

// Proposta X — o nome em porcelana, calculado pixel a pixel (raymarching). A rolagem refaz o
// volume do Íz no nome de cada casa, com a câmera mudando de enquadramento; o cursor dirige a luz
// e afunda a superfície onde toca.

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const fit = (v: number, a: number, b: number) => clamp((v - a) / (b - a))
const ease = (t: number) => 1 - Math.pow(1 - t, 3.2)
const $$ = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s))

const WORDS = ['Íz', '1929', 'Grá', 'Alata', 'Fulles', 'Hotel', 'nip']
// palavra, câmera, alvo, luz base, tom do esmalte, rolagem da câmera
const SHOTS = [
  { w: 0, pos: [0, 0.05, 6.0], tgt: [0, 0.0, 0], light: [-0.55, 0.75, 0.55], tint: [1, 1, 1], roll: 0, fov: 30 },
  { w: 1, pos: [-4.6, -0.45, 5.6], tgt: [0.3, -0.2, 0], light: [0.7, 0.55, 0.45], tint: [1.0, 0.97, 0.93], roll: 0.02, fov: 30 },
  { w: 2, pos: [0.4, 5.2, 4.6], tgt: [0, -0.4, 0], light: [-0.3, 0.9, -0.2], tint: [0.97, 0.98, 1.0], roll: 0, fov: 32 },
  { w: 3, pos: [3.4, 0.5, 4.4], tgt: [-0.4, -0.1, 0], light: [-0.6, 0.6, 0.6], tint: [1.0, 0.96, 0.97], roll: -0.03, fov: 34 },
  { w: 4, pos: [0.6, -0.3, 6.6], tgt: [0, 0.15, 0], light: [0.95, 0.18, 0.3], tint: [1.0, 0.95, 0.9], roll: 0, fov: 30 },
  { w: 5, pos: [5.4, 1.3, 3.0], tgt: [0.2, -0.2, 0], light: [-0.4, 0.8, 0.5], tint: [0.98, 0.98, 0.99], roll: 0.01, fov: 32 },
  { w: 6, pos: [0, 0.35, 6.4], tgt: [0, -0.15, 0], light: [0.5, 0.75, 0.6], tint: [1.0, 0.97, 0.94], roll: 0.04, fov: 30 },
  { w: 0, pos: [-1.6, 2.4, 9.6], tgt: [0, -0.4, 0], light: [-0.5, 0.8, 0.5], tint: [1, 1, 1], roll: 0, fov: 28 },
]
const PER = 1.3 // telas por cena

async function boot() {
  await Promise.all([document.fonts.load('80px "Instrument Serif"'), document.fonts.load('12px "JetBrains Mono Variable"')])
  const canvas = document.querySelector<HTMLCanvasElement>('.x-gl')!
  const P = new Porcelana(canvas)
  P.setAtlas(await wordAtlasExact(P.r, WORDS, fontUrl, 1024, 400))
  P.scale = 1
  P.resize()
  // piso na linha de base das palavras
  P.u.uFloorY.value = (0.5 - BASE) * P.u.uH.value
  ;(window as any).__x = P

  // legendas: cada linha entra mascarada
  const caps = $$('.x-cap').map((c) => {
    const lines = Array.from(c.children) as HTMLElement[]
    const inners = lines.map((l) => {
      const wrap = document.createElement('span')
      wrap.className = 'x-ln'
      l.replaceWith(wrap)
      wrap.appendChild(l)
      l.style.display = 'block'
      return l
    })
    return { el: c, inners }
  })

  const spacer = document.createElement('div')
  document.body.appendChild(spacer)
  const layout = () => {
    spacer.style.height = `${((SHOTS.length - 1) * PER + 1) * innerHeight}px`
    P.resize()
  }
  layout()
  addEventListener('resize', layout)

  const lenis = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : new Lenis({ lerp: 0.08, wheelMultiplier: 0.75 })
  $$('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const y = Number(a.dataset.go) * PER * innerHeight
      lenis ? lenis.scrollTo(y, { duration: 2.4 }) : scrollTo(0, y)
    }),
  )

  const ptr = { x: 0, y: 0, in: false, down: false }
  addEventListener('pointermove', (e) => {
    ptr.x = (e.clientX / innerWidth) * 2 - 1
    ptr.y = -(e.clientY / innerHeight) * 2 + 1
    ptr.in = true
  })
  addEventListener('pointerdown', () => (ptr.down = true))
  addEventListener('pointerup', () => (ptr.down = false))
  document.addEventListener('pointerleave', () => (ptr.in = false))

  const cam = { pos: new THREE.Vector3(0, 2.5, 12), tgt: new THREE.Vector3(0, -0.15, 0) }
  const light = new THREE.Vector3(-0.55, 0.75, 0.55)
  const tint = new THREE.Vector3(1, 1, 1)
  const press = new THREE.Vector4(0, 0, 0, 0)
  const mouse = { x: 0, y: 0 }
  const t0 = performance.now()
  let last = t0
  const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2])
  const lastPos = new THREE.Vector3()
  let lastU = 0
  let lastPress = 0

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lenis?.raf(now)
    const k = (n: number) => 1 - Math.pow(1 - n, dt * 60)
    const time = (now - t0) / 1000
    const u = scrollY / innerHeight / PER
    const i = Math.min(SHOTS.length - 2, Math.floor(u))
    const f = clamp(u - i)
    const A = SHOTS[i]
    const B = SHOTS[Math.min(SHOTS.length - 1, i + 1)]
    // a troca de palavra acontece no começo do trecho; a câmera viaja um pouco mais longa
    const morph = fit(f, 0.1, 0.7)
    const travel = ease(fit(f, 0.0, 0.85))
    const intro = ease(fit(time, 0.2, 3.2))

    mouse.x += ((ptr.in ? ptr.x : 0) - mouse.x) * k(0.06)
    mouse.y += ((ptr.in ? ptr.y : 0) - mouse.y) * k(0.06)

    const pos = v3(A.pos).lerp(v3(B.pos), travel)
    const tgt = v3(A.tgt).lerp(v3(B.tgt), travel)
    // a câmera respira e acompanha o cursor de leve
    pos.x += mouse.x * 0.35 + Math.sin(time * 0.31) * 0.05
    pos.y += mouse.y * 0.2 + Math.cos(time * 0.27) * 0.04
    if (innerWidth / innerHeight < 1) pos.sub(tgt).multiplyScalar(Math.min(2.2, 1.25 / (innerWidth / innerHeight))).add(tgt)
    // abertura: de longe e do alto até o enquadramento
    pos.lerp(new THREE.Vector3(0, 3.2, 14), 1 - intro)
    cam.pos.lerp(pos, k(0.12))
    cam.tgt.lerp(tgt, k(0.12))

    const bl = v3(A.light).lerp(v3(B.light), travel)
    bl.x += mouse.x * 0.9
    bl.y += mouse.y * 0.45
    light.lerp(bl.normalize(), k(0.08))
    tint.lerp(v3(A.tint).lerp(v3(B.tint), travel), k(0.08))

    // dedo na superfície: raio do cursor contra a face da frente
    const u_ = P.u
    {
      const ww = cam.tgt.clone().sub(cam.pos).normalize()
      const roll = A.roll + (B.roll - A.roll) * travel
      const up = new THREE.Vector3(Math.sin(roll), Math.cos(roll), 0)
      const uu = ww.clone().cross(up).normalize()
      const vv = uu.clone().cross(ww)
      const fl = 1 / Math.tan(THREE.MathUtils.degToRad(u_.uFov.value) / 2)
      const asp = innerWidth / innerHeight
      const rd = uu.multiplyScalar(mouse.x * asp).add(vv.multiplyScalar(mouse.y)).add(ww.multiplyScalar(fl)).normalize()
      const tz = (u_.uDepth.value - cam.pos.z) / rd.z
      const hit = cam.pos.clone().add(rd.multiplyScalar(tz))
      const want = ptr.in ? (ptr.down ? 1.6 : 0.55) : 0
      press.x += (hit.x - press.x) * k(0.25)
      press.y += (hit.y - press.y) * k(0.25)
      press.z = u_.uDepth.value
      press.w += (want - press.w) * k(ptr.down ? 0.12 : 0.05)
      u_.uRoll.value = roll
    }

    u_.uA.value = A.w
    u_.uB.value = B.w
    u_.uMix.value = A.w === B.w ? 0 : morph
    u_.uTime.value = time
    u_.uCamPos.value.copy(cam.pos)
    u_.uCamTarget.value.copy(cam.tgt)
    u_.uLight.value.copy(light)
    u_.uTint.value.copy(tint)
    u_.uFov.value = A.fov + (B.fov - A.fov) * travel
    u_.uPress.value.copy(press)
    // quanto a cena mudou neste quadro decide quanto do histórico guardar
    const moved = cam.pos.distanceTo(lastPos) * 30 + Math.abs(u - lastU) * 40 + Math.abs(press.w - lastPress) * 4
    lastPos.copy(cam.pos)
    lastU = u
    lastPress = press.w
    P.render(clamp(0.12 + moved, 0.12, 1))

    // legendas: a da cena atual entra, a anterior sai
    const cur = Math.round(u)
    caps.forEach((c, j) => {
      const d = u - j
      const inP = j === 0 ? fit(time, 1.6, 2.6) : fit(d, -0.45, -0.1)
      const outP = fit(d, 0.35, 0.6)
      const on = inP > 0 && outP < 1
      c.el.classList.toggle('is-on', on && j === cur)
      c.el.style.visibility = on ? 'visible' : 'hidden'
      c.inners.forEach((el, n) => {
        const a = ease(clamp(inP * 1.5 - n * 0.2))
        const b = ease(clamp(outP * 1.5 - n * 0.15))
        el.style.transform = `translate3d(0, ${((1 - a) * 105 - b * 105).toFixed(2)}%, 0)`
      })
    })
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
boot()
