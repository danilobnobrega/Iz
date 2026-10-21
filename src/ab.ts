import '@fontsource-variable/fraunces'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/instrument-serif'
import '@fontsource/instrument-serif/400-italic.css'
import './ab.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { captions, clamp, type Ctx, type Pointer, type Rect } from './y/core'
import { BookSec } from './ab/book'

// Proposta AB — o site é um livro pop-up sobre uma mesa. Rolar vira as páginas; cada página dupla
// tem um mecanismo de livro animado diferente.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!
const NAMES = ['capa', 'o nome', 'a origem', 'a trajetória', 'como a gente pensa', 'as casas', 'trabalhe conosco']

async function boot() {
  await document.fonts.ready
  const canvas = $<HTMLCanvasElement>('.y-gl')
  const r = new THREE.WebGLRenderer({ canvas, antialias: true })
  r.setClearColor(0x14100d, 1)
  r.autoClear = false
  r.shadowMap.enabled = true
  r.shadowMap.type = THREE.PCFSoftShadowMap
  r.toneMapping = THREE.ACESFilmicToneMapping
  r.toneMappingExposure = 1.05

  const el = $('[data-sec="book"]')
  const book = new BookSec(el)
  await book.init()
  const pin = $('.y-pin', el)
  const cap = captions(el)
  const label = $('.ab-h__p i')

  let dpr = Math.min(devicePixelRatio, 2)
  const resize = () => {
    dpr = Math.min(devicePixelRatio, 2)
    r.setPixelRatio(dpr)
    r.setSize(innerWidth, innerHeight, false)
    book.resize(innerWidth, innerHeight, dpr)
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

  const lenis = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : new Lenis({ lerp: 0.08, wheelMultiplier: 0.8 })
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
    const sr = el.getBoundingClientRect()
    const pr = pin.getBoundingClientRect()
    const p = clamp(-sr.top / Math.max(1, sr.height - innerHeight))
    cap(p)
    const uu = Math.max(0, Math.min(1, (p - 0.02) / 0.96)) * 6
    const sp = Math.max(0, Math.min(6, Math.floor(uu) + (uu - Math.floor(uu) > 0.75 ? 1 : 0)))
    if (label.textContent !== NAMES[sp]) label.textContent = NAMES[sp]
    if (pr.bottom > 0 && pr.top < innerHeight) {
      const rect: Rect = { x: 0, y: Math.round(pr.top), w: innerWidth, h: innerHeight }
      book.update(p, c, rect)
      book.render(c, rect)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  ;(window as any).__ab = { book, lenis, r }
}
boot()
