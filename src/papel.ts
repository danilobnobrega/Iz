import './papel.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { PaperStage, Print } from './gl/Paper'

// Proposta G: as fotos são cópias impressas. Cada passagem de seção é um gesto do papel.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.85 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3)
const vh = () => window.innerHeight

// quanto o elemento já entrou na tela (0 = abaixo, 1 = bem dentro)
const enter = (el: Element, span = 0.85) => clamp((vh() - el.getBoundingClientRect().top) / (vh() * span))
// progresso de uma seção com conteúdo preso (sticky)
const pinned = (el: Element) => {
  const r = el.getBoundingClientRect()
  return clamp(-r.top / Math.max(1, r.height - vh()))
}

function splitStepTitles() {
  document.querySelectorAll<HTMLElement>('.pp-step h3').forEach((h) => {
    let i = 0
    const walk = (node: Node, parent: HTMLElement) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          ;(child.textContent || '').split(/(\s+)/).forEach((part) => {
            if (!part) return
            if (/^\s+$/.test(part)) return void parent.appendChild(document.createTextNode(' '))
            const wd = document.createElement('span')
            wd.className = 'wd'
            const inner = document.createElement('span')
            inner.textContent = part
            inner.style.setProperty('--i', String(i++))
            wd.appendChild(inner)
            parent.appendChild(wd)
          })
        } else {
          const clone = (child as HTMLElement).cloneNode(false) as HTMLElement
          parent.appendChild(clone)
          walk(child, clone)
        }
      })
    }
    const src = h.cloneNode(true)
    h.textContent = ''
    walk(src, h)
  })
}

async function boot() {
  const stage = new PaperStage(document.querySelector<HTMLCanvasElement>('.pp-gl')!)
  splitStepTitles()
  document.querySelectorAll<HTMLElement>('.pp-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))

  // cópias simples
  const singles: { p: Print; fx: string }[] = []
  const hero = document.querySelector<HTMLElement>('.pp-hero')!
  const fim = document.querySelector<HTMLElement>('.pp-fim')!
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-print]'))) {
    const tex = await stage.texture(el.dataset.print!)
    const p = stage.add(new Print(el, tex, null, stage.paper, el.hasAttribute('data-full')))
    singles.push({ p, fx: el.dataset.fx || (el.closest('.pp-hero') ? 'curl' : '') })
  }

  // a cópia que vira (princípios)
  const flipEl = document.querySelector<HTMLElement>('[data-flip]')!
  const flipTex = await Promise.all(flipEl.dataset.flip!.split(',').map((s) => stage.texture(s)))
  const flip = stage.add(new Print(flipEl, flipTex[0], flipTex[1], stage.paper))
  let flipK = 0

  // o bloco de cópias (casas): a de cima é a primeira
  const deckEl = document.querySelector<HTMLElement>('[data-deck]')!
  const deckTex = await Promise.all(deckEl.dataset.deck!.split(',').map((s) => stage.texture(s)))
  const deck = deckTex.map((t, i) => {
    const p = stage.add(new Print(deckEl, t, null, stage.paper))
    p.fx.z = (deckTex.length - i) * 0.9
    p.fx.rot = (i % 2 ? 1 : -1) * (0.012 + ((i * 37) % 7) * 0.003)
    p.fx.curlDir = i % 2 ? [-1, -1] : [1, -1]
    p.fx.curlR = 70
    return p
  })

  const princ = document.querySelector<HTMLElement>('.pp-princ')!
  const casas = document.querySelector<HTMLElement>('.pp-casas')!
  const princSteps = Array.from(princ.querySelectorAll<HTMLElement>('.pp-step'))
  const casaSteps = Array.from(casas.querySelectorAll<HTMLElement>('.pp-step'))
  const heroTitle = document.querySelector<HTMLElement>('.pp-hero__title')!
  const fimText = document.querySelector<HTMLElement>('.pp-fim__text')!
  const setStep = (steps: HTMLElement[], i: number) => steps.forEach((s, j) => s.classList.toggle('is-on', j === i))

  const intro = { zoom: 1.14, title: 0 }

  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    stage.bow = clamp((lenis?.velocity ?? 0) * -1.4, -36, 36)

    // abertura: a cópia enrola a partir do canto inferior direito
    const hp = pinned(hero)
    for (const { p, fx } of singles) {
      if (fx === 'curl') {
        p.fx.curl = smooth(0.06, 0.92, hp)
        p.fx.curlDir = [1, -1]
        p.fx.curlR = Math.max(90, window.innerWidth * 0.08)
        p.fx.zoom = intro.zoom
        p.fx.alpha = 1 - smooth(0.9, 1, hp)
      } else if (fx === 'fold') {
        p.fx.fold = 1 - easeOut(enter(p.el, 0.9))
        p.fx.foldN = 5
      } else if (fx === 'tilt') {
        p.fx.tilt = (1 - easeOut(enter(p.el, 0.95))) * 1.2
      } else if (fx === 'slat') {
        p.fx.slat = easeOut(enter(p.el, 1.05))
        p.fx.slatN = 9
      } else if (fx === 'unroll') {
        const q = clamp((vh() - fim.getBoundingClientRect().top) / (vh() * 1.5))
        p.fx.curl = 1 - easeOut(q)
        p.fx.curlDir = [-1, 1]
        p.fx.curlR = Math.max(90, window.innerWidth * 0.08)
        p.fx.alpha = smooth(0, 0.08, q)
        fimText.style.opacity = String(smooth(0.6, 1, q))
      }
    }
    heroTitle.style.opacity = String(intro.title * (1 - smooth(0.02, 0.22, hp)))
    heroTitle.style.transform = `translateY(${hp * -60}px)`

    // princípios: uma cópia, quatro faces; pausa entre uma virada e outra
    const pt = pinned(princ) * (flipTex.length - 1)
    const k = Math.min(Math.floor(pt), flipTex.length - 2)
    if (k !== flipK) {
      flipK = k
      flip.setA(flipTex[k])
      flip.setB(flipTex[k + 1])
    }
    const f = smooth(0.3, 0.8, pt - k)
    flip.fx.flip = f
    flip.fx.z = 2
    setStep(princSteps, Math.round(k + f))

    // casas: folhear o bloco
    const ct = pinned(casas) * (deck.length - 1)
    let active = 0
    deck.forEach((p, i) => {
      if (i === deck.length - 1) return
      const c = smooth(0.2, 0.85, ct - i)
      p.fx.curl = c
      p.fx.alpha = 1 - smooth(0.9, 1, c)
      if (c > 0.5) active = i + 1
    })
    setStep(casaSteps, active)

    stage.render()
  })
  gsap.ticker.lagSmoothing(0)

  // texto que entra ao aparecer
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))), {
    rootMargin: '0px 0px -12% 0px',
  })
  document.querySelectorAll('[data-r]').forEach((el) => io.observe(el))

  document.querySelector('[data-top]')?.addEventListener('click', (e) => {
    e.preventDefault()
    lenis ? lenis.scrollTo(0, { duration: 2 }) : window.scrollTo(0, 0)
  })
  document.querySelectorAll<HTMLAnchorElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = document.querySelector<HTMLElement>(a.getAttribute('href')!)
      if (t) lenis ? lenis.scrollTo(t, { duration: 2.2 }) : t.scrollIntoView()
    }),
  )
  window.addEventListener('resize', () => stage.resize())

  await document.fonts.ready
  document.body.classList.remove('is-loading')
  gsap.to(intro, { zoom: 1, duration: 2.6, ease: 'expo.out' })
  gsap.to(intro, { title: 1, duration: 1.6, ease: 'power2.out', delay: 0.5, onComplete: () => lenis?.start() })
}

boot()
