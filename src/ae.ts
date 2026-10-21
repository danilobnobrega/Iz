import '@fontsource/instrument-serif'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import './ae.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { captions, clamp, type Ctx, type Pointer, type Rect, type Section } from './y/core'
import { DuskSec } from './ae/dusk'
import { DrinkSec } from './ae/drink'
import { RecordSec } from './ae/record'
import { DiscoSec } from './ae/disco'
import { CheersSec } from './ae/cheers'

// Proposta AE — uma noite com o Grupo Íz. A rolagem atravessa a noite das 18h à 1h: o pôr do sol
// a 192 metros com a cidade acendendo, o drinque no balcão, o disco, a pista, o brinde.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!

async function boot() {
  await Promise.all([
    document.fonts.load('80px "Instrument Serif"'),
    document.fonts.load('italic 80px "Instrument Serif"'),
    document.fonts.load('500 16px "Inter Tight Variable"'),
    document.fonts.load('12px "JetBrains Mono Variable"'),
  ])
  const r = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('.y-gl'), antialias: false, powerPreference: 'high-performance' })
  r.setClearColor(0x0b0907, 1)
  r.autoClear = false
  r.shadowMap.enabled = true

  const make: Record<string, (el: HTMLElement) => Section> = {
    dusk: (el) => new DuskSec(el),
    drink: (el) => new DrinkSec(el, r),
    record: (el) => new RecordSec(el, r),
    disco: (el) => new DiscoSec(el),
    cheers: (el) => new CheersSec(el, r),
  }
  const secs = Array.from(document.querySelectorAll<HTMLElement>('[data-sec]'))
    .filter((el) => make[el.dataset.sec!])
    .map((el) => {
      const s = make[el.dataset.sec!](el)
      return { s, el, pin: $('.y-pin', el), cap: captions(el) }
    })
  await Promise.all(secs.map((x) => x.s.init(r)))

  let dpr = Math.min(devicePixelRatio, 1.75)
  const resize = () => {
    dpr = Math.min(devicePixelRatio, 1.75)
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

  const lenis = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : new Lenis({ lerp: 0.08, wheelMultiplier: 0.85 })
  document.querySelectorAll<HTMLElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = document.querySelector<HTMLElement>(`[data-sec="${a.dataset.go}"]`)
      if (t) lenis ? lenis.scrollTo(t, { duration: 2.4 }) : t.scrollIntoView()
    }),
  )
  // o relógio: 18h no topo, 1h no fim da página
  const clock = $('.ae-clock i')
  const t0 = performance.now()
  let last = t0
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lenis?.raf(now)
    const c: Ctx = { r, dpr, vw: innerWidth, vh: innerHeight, t: (now - t0) / 1000, dt, ptr }
    const total = document.documentElement.scrollHeight - innerHeight
    const mins = 18 * 60 + Math.round((scrollY / Math.max(1, total)) * 7 * 60)
    const hh = Math.floor(mins / 60) % 24
    const mm = mins % 60
    const txt = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    if (clock.textContent !== txt) clock.textContent = txt
    r.setRenderTarget(null)
    r.setViewport(0, 0, innerWidth, innerHeight)
    r.clear()
    for (const x of secs) {
      const sr = x.el.getBoundingClientRect()
      const pr = x.pin.getBoundingClientRect()
      const p = clamp(-sr.top / Math.max(1, sr.height - innerHeight))
      x.cap(p)
      if (pr.bottom <= 0 || pr.top >= innerHeight) continue
      // cortina: a cena que sai sobe na metade da velocidade e escurece; a próxima desliza por cima
      const out = pr.top < 0 ? -pr.top / innerHeight : 0
      const rect: Rect = { x: 0, y: Math.round(pr.top * (out > 0 ? 0.5 : 1)), w: innerWidth, h: innerHeight }
      x.s.update(p, c, rect)
      const fu = (x.s as any).fx?.final.uniforms.uFade
      if (fu) fu.value *= 1 - out * 0.75
      x.s.render(c, rect)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  ;(window as any).__ae = { secs, lenis, r }
}
boot()
