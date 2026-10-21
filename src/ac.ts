import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import './ac.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { captions, clamp, type Ctx, type Pointer, type Rect, type Section } from './y/core'
import { PolarSec } from './ac/polar'
import { FoamSec } from './ac/foam'
import { EmulsionSec } from './ac/emulsion'
import { SmokeSec } from './ac/smoke'
import { SnowSec } from './ac/snow'
import { CellsSec } from './ac/cells'

// Proposta AC — ao microscópio. Cada seção é um fenômeno real da cozinha em escala pequena,
// simulado com a física dele: cristais sob luz polarizada, espuma de fermentação, emulsão,
// fumaça e brasa, um floco de neve crescendo, células se dividindo.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!

async function boot() {
  await Promise.all([document.fonts.load('600 40px "Inter Tight Variable"'), document.fonts.load('800 40px "Inter Tight Variable"'), document.fonts.load('12px "JetBrains Mono Variable"')])
  const canvas = $<HTMLCanvasElement>('.y-gl')
  const r = new THREE.WebGLRenderer({ canvas, antialias: true })
  r.setClearColor(0x050506, 1)
  r.autoClear = false

  const make: Record<string, (el: HTMLElement) => Section> = {
    hero: (el) => new PolarSec(el),
    foam: (el) => new FoamSec(el),
    emulsion: (el) => new EmulsionSec(el),
    smoke: (el) => new SmokeSec(el),
    snow: (el) => new SnowSec(el),
    cells: (el) => new CellsSec(el),
  }
  const secs = Array.from(document.querySelectorAll<HTMLElement>('[data-sec]'))
    .filter((el) => make[el.dataset.sec!])
    .map((el) => {
      const s = make[el.dataset.sec!](el)
      return { s, el, pin: $('.y-pin', el), cap: captions(el) }
    })
  await Promise.all(secs.map((x) => x.s.init(r)))

  let dpr = Math.min(devicePixelRatio, 2)
  const resize = () => {
    dpr = Math.min(devicePixelRatio, 2)
    r.setPixelRatio(dpr)
    r.setSize(innerWidth, innerHeight, false)
    secs.forEach((x) => x.s.resize(innerWidth, innerHeight, dpr))
  }
  resize()
  addEventListener('resize', resize)

  const ptr: Pointer = { x: 0, y: 0, px: -999, py: -999, vx: 0, vy: 0, inside: false, down: false }
  addEventListener('pointermove', (e) => {
    ptr.px = e.clientX
    ptr.py = e.clientY
    ptr.inside = true
  })
  addEventListener('pointerdown', () => (ptr.down = true))
  addEventListener('pointerup', () => (ptr.down = false))
  document.addEventListener('pointerleave', () => (ptr.inside = false))

  const lenis = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.85 })
  document.querySelectorAll<HTMLElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = document.querySelector<HTMLElement>(`[data-sec="${a.dataset.go}"]`)
      if (t) lenis ? lenis.scrollTo(t, { duration: 2 }) : t.scrollIntoView()
    }),
  )

  const t0 = performance.now()
  let last = t0
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lenis?.raf(now)
    const c: Ctx = { r, dpr, vw: innerWidth, vh: innerHeight, t: (now - t0) / 1000, dt, ptr }
    r.setRenderTarget(null)
    r.setViewport(0, 0, innerWidth, innerHeight)
    r.clear()
    for (const x of secs) {
      const sr = x.el.getBoundingClientRect()
      const pr = x.pin.getBoundingClientRect()
      const p = clamp(-sr.top / Math.max(1, sr.height - innerHeight))
      x.cap(p)
      if (pr.bottom <= 0 || pr.top >= innerHeight) continue
      const rect: Rect = { x: 0, y: Math.round(pr.top), w: innerWidth, h: innerHeight }
      x.s.update(p, c, rect)
      x.s.render(c, rect)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  ;(window as any).__ac = { secs, lenis, r }
}
boot()
