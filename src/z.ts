import '@fontsource-variable/big-shoulders-display'
import '@fontsource/instrument-serif'
import './z.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { captions, clamp, type Ctx, type Pointer, type Rect, type Section } from './y/core'
import { RDSec } from './z/rd'
import { FlapSec } from './z/flap'
import { RibbonSec } from './z/ribbon'
import { OpArtSec } from './z/opart'
import { ShardsSec } from './z/shards'
import { JellySec } from './z/jelly'
import { ConfettiSec } from './z/confetti'
import { DISPLAY } from './z/pal'

// Proposta Z — vibrante: cor saturada, letra condensada, ritmo rápido, e uma técnica diferente em
// cada seção (reação-difusão, painel de plaquetas, montanha-russa, op-art, vitral, gelatina, confete).

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!

async function boot() {
  await Promise.all([document.fonts.load(`800 40px ${DISPLAY}`), document.fonts.load(`900 40px ${DISPLAY}`), document.fonts.load('40px "Instrument Serif"')])
  const canvas = $<HTMLCanvasElement>('.y-gl')
  const r = new THREE.WebGLRenderer({ canvas, antialias: true })
  r.setClearColor(0xf3ecdf, 1)
  r.autoClear = false

  const make: Record<string, (el: HTMLElement) => Section> = {
    hero: (el) => new RDSec(el, 'ÍZ'),
    painel: (el) =>
      new FlapSec(
        el,
        [
          ['ÍZ É', 'PALADAR', 'EM HÚNGARO'],
          ['DOIS AMIGOS', 'DO KARATÊ'],
          ['7 CASAS', '1 COZINHA'],
          ['445', 'PESSOAS'],
          ['50 MIL', 'CLIENTES', 'POR MÊS'],
          ['GOIÂNIA', 'DESDE 2015'],
        ],
        ['PALADAR', 'KARATÊ', '7 CASAS', '445', '50 MIL', '2015'],
      ),
    trajetoria: (el) => new RibbonSec(el),
    principios: (el) => new OpArtSec(el, ['CUIDADO, NÃO POMPA', 'LINGUAGEM, NÃO REGRA', 'LOCAL SEM SER ÓBVIO', 'NADA DE ACOMODAÇÃO']),
    pratos: (el) => new ShardsSec(el, ['nip_pizza', 'caviar', 'nip_pistache', 'iz_rest', 'sorvete', 'nip_polpetone']),
    casas: (el) => new JellySec(el),
    trabalhe: (el) => new ConfettiSec(el),
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
  addEventListener('pointerdown', (e) => {
    ptr.down = true
    ptr.px = e.clientX
    ptr.py = e.clientY
    ptr.inside = true
  })
  addEventListener('pointerup', () => (ptr.down = false))
  document.addEventListener('pointerleave', () => (ptr.inside = false))

  const lenis = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 })
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
  ;(window as any).__z = { secs, lenis, r }
}
boot()
