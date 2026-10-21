import '@fontsource-variable/jetbrains-mono'
import '@fontsource/instrument-serif'
import './y.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { captions, clamp, type Ctx, type Pointer, type Rect, type Section } from './y/core'
import { PorcelainSec } from './y/porcelain'
import { InkSec } from './y/ink'
import { RelightSec } from './y/relight'
import { RingSec } from './y/ring'
import { ParticlesSec } from './y/particles'
import { GlassSec } from './y/glass'
import { TilesSec } from './y/tiles'
import { StoneSec } from './y/stone'

// Proposta Y — um site longo, uma técnica de WebGL diferente por seção, todas na mesma família:
// o mesmo papel, a mesma tinta, a mesma tipografia, a mesma curva. Um canvas só, fixo; cada
// seção desenha dentro do retângulo da sua área presa enquanto ela está na tela.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!

async function boot() {
  await Promise.all([document.fonts.load('40px "Instrument Serif"'), document.fonts.load('12px "JetBrains Mono Variable"')])
  const canvas = $<HTMLCanvasElement>('.y-gl')
  const r = new THREE.WebGLRenderer({ canvas, antialias: true })
  r.setClearColor(0xe3e0db, 1)
  r.autoClear = false
  r.shadowMap.enabled = true
  r.shadowMap.type = THREE.PCFSoftShadowMap

  const make: Record<string, (el: HTMLElement) => Section> = {
    hero: (el) => new PorcelainSec(el, 'Íz', 'sink'),
    paladar: (el) => new InkSec(el, ['Íz é paladar,', 'em húngaro.']),
    origem: (el) => new RelightSec(el, 'socios'),
    trajetoria: (el) => new RingSec(el),
    principios: (el) => new ParticlesSec(el, ['Cuidado, não pompa.', 'Linguagem, não regra.', 'Local, sem ser óbvio.', 'Nada de acomodação.']),
    casas: (el) => new GlassSec(el),
    portras: (el) => new TilesSec(el),
    reconhecimento: (el) => new StoneSec(el, '12º'),
    trabalhe: (el) => new PorcelainSec(el, '520', 'rise'),
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
    ptr.x = (e.clientX / innerWidth) * 2 - 1
    ptr.y = -(e.clientY / innerHeight) * 2 + 1
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
      if (!t) return
      lenis ? lenis.scrollTo(t, { duration: 2.4 }) : t.scrollIntoView()
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
  ;(window as any).__y = { secs, lenis }
}
boot()
