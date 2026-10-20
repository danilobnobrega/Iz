import './p.css'
import './q.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Planta } from './gl/Planta'

// Proposta Q — "A planta": o Íz como edifício. A câmera desce da vista aérea
// e caminha pelas galerias, onde as casas estão penduradas como obras.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.07, wheelMultiplier: 0.8 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const $$ = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s))

const HOUSES = [
  { name: 'Íz', meta: 'Contemporânea · Setor Marista · desde 2015', img: '/img/iz_unnamed.webp' },
  { name: '1929 Trattoria', meta: 'Italiana · o ano da avó, Dona Colombina', img: '/img/t1929.webp' },
  { name: 'Grá', meta: 'Bistrô francês · 192 metros acima de Goiânia', img: '/img/gra2.webp' },
  { name: 'Alata', meta: 'Sorvete artesanal', img: '/img/nip_pistache.webp' },
  { name: 'Fulles Kitchen', meta: 'Cozinha na lenha', img: '/img/nip_polpetone.webp' },
  { name: 'Íz Hotel', meta: 'Restaurant with rooms · três suítes', img: '/img/iz_9.webp' },
  { name: 'nip', meta: 'Not in Napoli · Rua 1130', img: '/img/nip_fachada.webp' },
]

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
function scramble(el: HTMLElement, text = el.dataset.txt || '', dur = 0.8) {
  el.dataset.txt = text
  const o = { p: 0 }
  gsap.killTweensOf(el)
  gsap.to(o, {
    p: 1,
    duration: dur + text.length * 0.012,
    ease: 'power2.out',
    onUpdate: () => {
      const n = o.p * text.length
      let s = ''
      for (let i = 0; i < text.length; i++) s += text[i] === ' ' || i < n - 2 ? text[i] : i < n + 3 ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : ' '
      el.textContent = s
    },
    onComplete: () => void (el.textContent = text),
  })
}

function splitLines(el: HTMLElement) {
  const tmp = document.createElement('div')
  tmp.innerHTML = el.innerHTML
  el.innerHTML = ''
  const words: HTMLElement[] = []
  const walk = (node: Node, parent: HTMLElement) =>
    node.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE)
        (c.textContent || '').split(/(\s+)/).forEach((p) => {
          if (!p) return
          if (/^\s+$/.test(p)) return void parent.appendChild(document.createTextNode(' '))
          const w = document.createElement('span')
          w.textContent = p
          parent.appendChild(w)
          words.push(w)
        })
      else {
        const cl = (c as HTMLElement).cloneNode(false) as HTMLElement
        parent.appendChild(cl)
        walk(c, cl)
      }
    })
  walk(tmp, el)
  const lines: HTMLElement[][] = []
  let last = -1
  words.forEach((w) => {
    const t = Math.round(w.getBoundingClientRect().top)
    if (last < 0 || Math.abs(t - last) > 4) lines.push([])
    last = t
    lines[lines.length - 1].push(w)
  })
  el.innerHTML = ''
  lines.forEach((ws, i) => {
    const ln = document.createElement('span')
    ln.className = 'ln'
    const inner = document.createElement('span')
    inner.style.setProperty('--i', String(i))
    ws.forEach((w, j) => {
      let node: Node = document.createTextNode(w.textContent || '')
      if (w.parentElement?.tagName === 'EM') {
        const em = document.createElement('em')
        em.appendChild(node)
        node = em
      }
      inner.appendChild(node)
      if (j < ws.length - 1) inner.appendChild(document.createTextNode(' '))
    })
    ln.appendChild(inner)
    el.appendChild(ln)
  })
}

async function boot() {
  await document.fonts.ready
  $$('[data-lines]').forEach(splitLines)
  const planta = new Planta($<HTMLCanvasElement>('.q-gl'))
  const loadN = $('.q-load__n')
  const shown = { v: 0 }
  await planta.build(
    HOUSES.map((h) => h.img),
    (p) => gsap.to(shown, { v: p * 100, duration: 0.4, onUpdate: () => void (loadN.textContent = String(Math.round(shown.v)).padStart(3, '0')) }),
  )

  let mx = 0
  let my = 0
  let sx = 0
  let sy = 0
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX / window.innerWidth - 0.5
    my = e.clientY / window.innerHeight - 0.5
  })

  const walk = $('.q-walk')
  const intro = $('.q-intro')
  const house = $('.q-house')
  const hName = $('.q-house__name')
  const hMeta = $('.q-house__meta')
  const hNum = $('.q-house__n')
  const cards = $$('.p-card')
  cards.forEach((c, i) => c.style.setProperty('--k', String(i)))
  const markLetters = $$('.p-f__mark span')
  let active = -1
  let mxPx = 0
  let myPx = 0
  window.addEventListener('pointermove', (e) => {
    mxPx = e.clientX
    myPx = e.clientY
  })

  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const H = window.innerHeight
    const W = window.innerWidth
    sx += (mx - sx) * 0.05
    sy += (my - sy) * 0.05
    const r = walk.getBoundingClientRect()
    const wp = clamp(-r.top / (r.height - H))
    planta.progress = wp
    intro.style.opacity = String(1 - clamp(wp / 0.04))
    // a casa diante da câmera
    const h = wp > 0.1 && wp < 0.92 ? planta.nearest() : -1
    house.classList.toggle('is-on', h >= 0)
    if (h !== active) {
      active = h
      if (h >= 0) {
        hNum.textContent = String(h + 1).padStart(2, '0')
        scramble(hName, HOUSES[h].name, 0.55)
        scramble(hMeta, HOUSES[h].meta, 0.45)
      }
    }
    if (r.bottom > 0) planta.render(sx, sy, time)

    // cartas empilhadas e rodapé (mesma família da P)
    cards.forEach((c, i) => {
      const next = cards[i + 1]
      if (!next) return
      const nr = next.getBoundingClientRect()
      const k = clamp((H - nr.top) / (H * 0.88))
      c.style.setProperty('--sc', String(1 - k * 0.06))
      c.style.setProperty('--br', String(1 - k * 0.35))
    })
    markLetters.forEach((l) => {
      const b = l.getBoundingClientRect()
      const d = Math.hypot(mxPx - (b.left + b.width / 2), myPx - (b.top + b.height / 2))
      const k = clamp(1 - d / (W * 0.45))
      const cur = parseFloat(l.style.getPropertyValue('--w') || '200')
      l.style.setProperty('--w', String(Math.round(cur + (200 + 700 * k - cur) * 0.12)))
      l.style.setProperty('--s', String(Math.round(k * 100)))
    })
  })
  gsap.ticker.lagSmoothing(0)

  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))), {
    rootMargin: '0px 0px -12% 0px',
  })
  $$('[data-lines], [data-r]').forEach((el) => io.observe(el))

  $$('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = $((a as HTMLAnchorElement).getAttribute('href')!)
      lenis ? lenis.scrollTo(t, { duration: 2.4 }) : t.scrollIntoView()
    }),
  )
  $$('[data-top]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      lenis ? lenis.scrollTo(0, { duration: 3 }) : window.scrollTo(0, 0)
    }),
  )
  window.addEventListener('resize', () => planta.resize())

  // entrada: vista aérea, as paredes sobem como numa maquete sendo montada
  $$('[data-scr]').forEach((el) => {
    el.dataset.txt = el.textContent || ''
    el.textContent = ' '
  })
  $('.q-load').classList.add('is-done')
  document.body.classList.remove('is-loading')
  gsap
    .timeline({ delay: 0.3 })
    .to(planta.rise, { v: 1, duration: 3.4, ease: 'power2.inOut' })
    .add(() => $$('[data-scr]').forEach((el, i) => setTimeout(() => scramble(el), i * 180)), '-=1.2')
    .add(() => lenis?.start(), '-=0.4')
}

boot()
