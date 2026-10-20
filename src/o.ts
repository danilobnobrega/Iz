import './o.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import * as THREE from 'three'
import { LuzStage, rectOf, type LitPhoto, type Rect } from './gl/Luz'

const DARK = new THREE.Color('#0f0d0b')
const PAPER = new THREE.Color('#ece5d9')
const bgCol = DARK.clone()

// Proposta O: o restaurante abrindo para o jantar. A estrutura é a de sempre;
// a luz é o que amarra: as fotos acendem, o cursor ilumina.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.08, wheelMultiplier: 0.85 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const $$ = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s))

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
function scramble(el: HTMLElement, dur = 0.9) {
  const text = el.dataset.txt || ''
  const o = { p: 0 }
  return gsap.to(o, {
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

async function boot() {
  const stage = new LuzStage($<HTMLCanvasElement>('.o-gl'), '#0f0d0b')
  const loadN = $('.o-load__n')
  const shown = { v: 0 }
  await document.fonts.ready

  // fotos
  const srcs = ['/img/iz_unnamed.webp', ...$$('[data-src]').map((e) => e.dataset.src!)]
  let done = 0
  const bump = () => gsap.to(shown, { v: (++done / srcs.length) * 100, duration: 0.4, onUpdate: () => void (loadN.textContent = String(Math.round(shown.v)).padStart(3, '0')) })
  const hero = await stage.photo(srcs[0], true)
  bump()
  hero.exposure = 0
  hero.lamp = 0
  const slideEls = $$('.o-slide__img')
  const slides: LitPhoto[] = []
  for (const el of slideEls) {
    const p = await stage.photo(el.dataset.src!, true)
    p.exposure = 0.15
    slides.push(p)
    bump()
  }
  const btsEl = $('.o-bts__img')
  const bts = await stage.photo(btsEl.dataset.src!, true)
  bump()

  let mx = -9999
  let my = -9999
  let lx = -9999
  let ly = -9999
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
    if (lx < -999) {
      lx = mx
      ly = my
    }
  })

  // ---------- quadro a quadro ----------
  const heroSec = $('.o-hero')
  const heroT = $('.o-hero__t')
  const casas = $('.o-casas')
  const track = $('.o-casas__track')
  const slideArts = $$('.o-slide')
  const btsSec = $('.o-bts')
  const rows = $$('.o-rows li')
  const intro = { done: false }
  const collapse = (r: Rect): Rect => ({ x: r.x, y: r.y + r.h, w: r.w, h: 0 })

  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const W = window.innerWidth
    const H = window.innerHeight
    // a luz do cursor tem um pouco de inércia, como uma vela carregada na mão
    lx += (mx - lx) * 0.1
    ly += (my - ly) * 0.1

    // abertura: a foto em tela cheia encolhe e pousa como retrato no grupo
    const hr = heroSec.getBoundingClientRect()
    const hp = clamp(-hr.top / (hr.height - H))
    // o pouso acompanha a chegada do retrato: termina quando ele está centrado na tela
    const full = rectOf($('[data-a="hero"]'))
    const card = rectOf($('[data-a="card"]'))
    const land = smooth(0, 1, (H - card.y) / (H - (H - card.h) / 2))
    hero.from = { x: 0, y: 0, w: W, h: H }
    hero.to = card
    hero.p = intro.done ? land : 0
    if (!intro.done) hero.from = full
    if (intro.done) hero.exposure = 0.68 + 0.32 * land
    hero.zoom = 1.06 - 0.06 * land
    heroT.style.opacity = String(1 - smooth(0.02, 0.18, hp))

    // casas: a fila corre; a casa no centro acende
    const cr = casas.getBoundingClientRect()
    const cp = clamp(-cr.top / (cr.height - H))
    track.style.transform = `translate3d(${-cp * (track.scrollWidth - W)}px, 0, 0)`
    slides.forEach((p, i) => {
      const r = rectOf(slideEls[i])
      p.from = r
      p.to = r
      p.p = 0
      const d = Math.abs(r.x + r.w / 2 - W / 2) / (W * 0.5)
      const on = 1 - smooth(0.05, 0.6, d)
      p.exposure += (0.12 + 0.88 * on - p.exposure) * 0.06
      p.spotOn = p.spotOn.map((v) => v + (on - v) * 0.08)
      slideArts[i].style.setProperty('--o', String(0.3 + 0.7 * on))
    })
    // fundo: escuro na abertura, nas casas e nos bastidores; papel no resto
    const mid = (el: Element) => {
      const b = el.getBoundingClientRect()
      return b.top < H * 0.55 && b.bottom > H * 0.45
    }
    const dark = hp < 0.45 || mid(casas) || mid(btsSec)
    document.body.classList.toggle('on-dark', dark || (cr.top < 60 && cr.bottom > 60))
    bgCol.lerp(dark ? DARK : PAPER, 0.07)
    ;(stage.scene.background as THREE.Color).copy(bgCol)

    // bastidores: acende ao entrar
    const br = rectOf(btsEl)
    const be = smooth(0, 0.9, (H - br.y) / (H * 1.1))
    bts.from = collapse(br)
    bts.to = br
    bts.p = be
    bts.exposure = 0.1 + 0.55 * smooth(0.4, 1, be)
    bts.spotOn = bts.spotOn.map(() => smooth(0.3, 0.8, be))

    // princípios: a linha mais perto do centro acende
    let best = -1
    let bestD = Infinity
    rows.forEach((li, i) => {
      const b = li.getBoundingClientRect()
      const d = Math.abs(b.top + b.height / 2 - H / 2)
      if (d < bestD && b.top < H && b.bottom > 0) {
        bestD = d
        best = i
      }
    })
    rows.forEach((li, i) => li.classList.toggle('is-on', i === best))

    stage.render(lx, ly, lenis ? lenis.velocity : 0)
  })
  gsap.ticker.lagSmoothing(0)

  // ---------- reveals ----------
  $$('[data-lines]').forEach(splitLines)
  $$('[data-odo]').forEach((el) => {
    el.innerHTML = ''
    ;(el.dataset.odo || '0').split('').forEach((d, i) => {
      const col = document.createElement('span')
      col.className = 'col'
      col.dataset.d = d
      col.style.setProperty('--i', String(i))
      col.innerHTML = Array.from({ length: 10 }, (_, k) => `<span>${k}</span>`).join('')
      el.appendChild(col)
    })
  })
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target as HTMLElement
        el.classList.add('is-in')
        if (el.matches('[data-odo]')) el.querySelectorAll<HTMLElement>('.col').forEach((c) => (c.style.transform = `translateY(${-Number(c.dataset.d) * 0.9}em)`))
        io.unobserve(el)
      }),
    { rootMargin: '0px 0px -12% 0px' },
  )
  $$('[data-lines], [data-r], [data-odo]').forEach((el) => io.observe(el))

  // ---------- navegação ----------
  $$('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = $((a as HTMLAnchorElement).getAttribute('href')!)
      lenis ? lenis.scrollTo(t, { duration: 2.2 }) : t.scrollIntoView()
    }),
  )
  $$('[data-top]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      lenis ? lenis.scrollTo(0, { duration: 2.6 }) : window.scrollTo(0, 0)
    }),
  )
  window.addEventListener('resize', () => stage.resize())

  // ---------- entrada: as luzes acendem uma a uma, depois a sala clareia ----------
  $$('[data-scr]').forEach((el) => {
    el.dataset.txt = el.textContent || ''
    el.textContent = ' '
  })
  $('.o-load').classList.add('is-done')
  document.body.classList.remove('is-loading')
  const tl = gsap.timeline({ delay: 0.5 })
  hero.spotOn.forEach((_, i) => {
    const o = { v: 0 }
    tl.to(
      o,
      {
        keyframes: [
          { v: 0.6, duration: 0.06 },
          { v: 0.1, duration: 0.07 },
          { v: 1.15, duration: 0.18 },
          { v: 1, duration: 0.4, ease: 'power2.out' },
        ],
        onUpdate: () => void (hero.spotOn[i] = o.v),
      },
      0.15 + i * 0.16,
    )
  })
  const lit = 0.15 + hero.spotOn.length * 0.16 + 0.2
  tl.to(hero, { exposure: 0.68, duration: 2.4, ease: 'power2.inOut' }, lit - 0.6)
    .to(hero, { lamp: 1, duration: 1.6, ease: 'power2.out' }, lit)
    .add(() => $$('.o-hero__t [data-scr]').forEach((el, i) => setTimeout(() => scramble(el), i * 180)), lit + 0.2)
    .add(() => {
      intro.done = true
      lenis?.start()
    }, lit + 1.2)
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

boot()
