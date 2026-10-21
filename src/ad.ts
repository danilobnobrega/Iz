import '@fontsource/instrument-serif'
import '@fontsource-variable/jetbrains-mono'
import './ad.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { captions, clamp, type Ctx, type Pointer, type Rect } from './y/core'
import { JourneySec, type Stop } from './ad/journey'

// Proposta AD — entrar nas casas. As fotos dos lugares viram espaços em 3D (pela profundidade),
// a câmera entra em cada um, e na troca a cena se desfaz em pontos que se montam no próximo lugar.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!

const STOPS: Stop[] = [
  { kind: 'text', text: 'Íz', color: '#f3ece0' },
  { kind: 'photo', img: 'socios', depth: 0.8 },
  { kind: 'photo', img: 'iz_unnamed', depth: 1.1 },
  { kind: 'photo', img: 't1929', depth: 1.2 },
  { kind: 'photo', img: 'gra2', depth: 1.1 },
  { kind: 'text', text: 'Alata', color: '#ff9fcf' },
  { kind: 'text', text: 'Fulles', color: '#ff8a3c' },
  { kind: 'photo', img: 'iz_9', depth: 1.0 },
  { kind: 'photo', img: 'nip_fachada', depth: 0.9 },
  { kind: 'photo', img: 'nip_pizza', depth: 0.7 },
  { kind: 'text', text: '520', color: '#f3ece0' },
]
const CAPS = [
  '<b>Íz</b><small>paladar, em húngaro · sete casas em Goiânia</small>',
  '<b>A origem</b><small>Ian Baiocchi e Domingos Ávila · amigos do karatê</small>',
  '<b>Íz</b><small>Contemporânea · Setor Marista · desde 2015</small>',
  '<b>1929 Trattoria</b><small>Italiana · o ano da avó, Dona Colombina</small>',
  '<b>Grá</b><small>Bistrô francês · 192 metros acima da cidade</small>',
  '<b>Alata</b><small>Sorvete artesanal</small>',
  '<b>Fulles Kitchen</b><small>Cozinha na lenha</small>',
  '<b>Íz Hotel</b><small>Restaurant with rooms · três suítes</small>',
  '<b>nip</b><small>Not in Napoli · Rua 1130 · 2026</small>',
  '<b>À mesa</b><small>Margherita DOG · denominação de origem goiana</small>',
  '<b>520</b><small>pessoas em 2026 · trabalhe conosco</small>',
]

async function boot() {
  await Promise.all([document.fonts.load('80px "Instrument Serif"'), document.fonts.load('12px "JetBrains Mono Variable"')])
  const r = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('.y-gl'), antialias: true })
  r.setClearColor(0x0d0b0a, 1)
  r.autoClear = false
  const el = $('[data-sec="journey"]')
  const sec = new JourneySec(el, STOPS, CAPS)
  await sec.init()
  const pin = $('.y-pin', el)
  const cap = captions(el)
  let dpr = Math.min(devicePixelRatio, 2)
  const resize = () => {
    dpr = Math.min(devicePixelRatio, 2)
    r.setPixelRatio(dpr)
    r.setSize(innerWidth, innerHeight, false)
    sec.resize(innerWidth, innerHeight, dpr)
  }
  resize()
  addEventListener('resize', resize)
  const ptr: Pointer = { x: 0, y: 0, px: -999, py: -999, vx: 0, vy: 0, inside: false, down: false }
  addEventListener('pointermove', (e) => {
    ptr.px = e.clientX
    ptr.py = e.clientY
    ptr.inside = true
  })
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
    if (pr.bottom > 0 && pr.top < innerHeight) {
      const rect: Rect = { x: 0, y: Math.round(pr.top), w: innerWidth, h: innerHeight }
      sec.update(p, c, rect)
      sec.render(c, rect)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  ;(window as any).__ad = { sec, lenis }
}
boot()
