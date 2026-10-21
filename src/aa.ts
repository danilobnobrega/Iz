import '@fontsource-variable/fraunces'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/instrument-serif'
import '@fontsource/instrument-serif/400-italic.css'
import './aa.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { captions, clamp, type Ctx, type Pointer, type Rect, type Section } from './y/core'
import { PaintSec } from './aa/paint'
import { CausticsSec } from './aa/caustics'
import { BeamsSec } from './aa/beams'
import { NeonSec } from './aa/neon'
import { PrismSec } from './aa/prism'
import { ShadowSec } from './aa/shadows'
import { CandlesSec } from './aa/candles'

// Proposta AA — luz no escuro. Cada seção é um fenômeno de luz diferente (pintura de luz em longa
// exposição, cáusticas, feixes volumétricos, neon com chão molhado, prisma, escultura de sombra,
// campo de velas), todos no mesmo escuro quente, com a mesma tipografia e o mesmo ritmo.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!

async function boot() {
  await Promise.all([
    document.fonts.load('300 40px "Fraunces Variable"'),
    document.fonts.load('12px "JetBrains Mono Variable"'),
    document.fonts.load('italic 40px "Instrument Serif"'),
  ])
  const canvas = $<HTMLCanvasElement>('.y-gl')
  const r = new THREE.WebGLRenderer({ canvas, antialias: true })
  r.setClearColor(0x060504, 1)
  r.autoClear = false
  r.shadowMap.enabled = true
  r.shadowMap.type = THREE.PCFSoftShadowMap

  const make: Record<string, (el: HTMLElement) => Section> = {
    hero: (el) => new PaintSec(el),
    nome: (el) => new CausticsSec(el, ['Íz é paladar,', 'em húngaro.']),
    origem: (el) => new BeamsSec(el, 'socios'),
    trajetoria: (el) => new NeonSec(el),
    principios: (el) => new PrismSec(el, ['Cuidado, não pompa.', 'Linguagem, não regra.', 'Local, sem ser óbvio.', 'Nada de acomodação.']),
    casas: (el) =>
      new ShadowSec(
        el,
        ['Íz', '1929', 'Grá', 'Alata', 'Fulles', 'Hotel', 'nip'],
        ['Íz · contemporânea, 2015', '1929 Trattoria · o ano da avó', 'Grá · bistrô francês a 192 m', 'Alata · sorvete artesanal', 'Fulles Kitchen · cozinha na lenha', 'Íz Hotel · três suítes', 'nip · Not in Napoli'],
      ),
    trabalhe: (el) => new CandlesSec(el),
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
    ptr.vx = e.clientX - ptr.px
    ptr.vy = e.clientY - ptr.py
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
      if (t) lenis ? lenis.scrollTo(t, { duration: 2.2 }) : t.scrollIntoView()
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
    ptr.vx *= 0.8
    ptr.vy *= 0.8
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  ;(window as any).__aa = { secs, lenis, r }
}
boot()
