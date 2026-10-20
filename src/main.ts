import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { Stage } from './gl/Stage'
import { tickPointer } from './ui/pointer'
import { initCursor } from './ui/cursor'
import { initText, typeText } from './ui/text'
import { initClock, initSections } from './ui/frame'
import { initRitual } from './ui/ritual'
import { initHovers } from './ui/hovers'

gsap.registerPlugin(ScrollTrigger)

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)

const lenis = reduce ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 })
lenis?.stop()
lenis?.on('scroll', ScrollTrigger.update)

async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.gl')!
  const stage = new Stage(canvas)
  stage.hero.dot = 0

  const index = document.querySelector<HTMLElement>('.ficha__index')!
  initClock()

  // o ponto aparece antes de tudo
  const shown = { v: 0 }
  const setCount = (p: number) => {
    gsap.to(shown, {
      v: p * 100,
      duration: 0.6,
      ease: 'power2.out',
      onUpdate: () => void (index.textContent = String(Math.round(shown.v)).padStart(3, '0')),
    })
  }

  const loop = { cursor: initCursor(), hovers: (_: number) => {} }
  gsap.ticker.add((time, dtMs) => {
    const dt = Math.min(dtMs / 1000, 0.05)
    lenis?.raf(time * 1000)
    tickPointer(dt)
    loop.cursor(dt)
    loop.hovers(dt)
    stage.render()
  })
  gsap.ticker.lagSmoothing(0)
  gsap.to(stage.hero, { dot: 6, duration: 0.6, ease: 'back.out(2)' })

  await document.fonts.load("640 120px 'Fraunces Variable'")
  await document.fonts.ready
  const minTime = new Promise((r) => setTimeout(r, 1400))
  await stage.load((p) => setCount(p * 0.96))
  await minTime
  setCount(1)

  // texto
  initText()
  loop.hovers = initHovers()
  const sections = initSections()
  initRitual(lenis)

  // hero ligado ao scroll
  const heroCopy = document.querySelector<HTMLElement>('.hero__copy')!
  const heroSide = document.querySelectorAll<HTMLElement>('.hero__list, .hero__scroll')
  ScrollTrigger.create({
    trigger: '#hero',
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => {
      stage.hero.scroll = self.progress
      const fade = 1 - Math.min(1, self.progress / 0.12)
      heroCopy.style.opacity = String(fade)
      heroSide.forEach((el) => (el.style.opacity = String(fade * 0.6)))
    },
  })
  ScrollTrigger.create({
    trigger: '#hero',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => (stage.hero.visible = self.isActive),
  })

  window.addEventListener('resize', () => {
    stage.resize()
    ScrollTrigger.refresh()
  })

  // entrada: o ponto vira a marca, a marca vira janela
  const title = document.querySelector<HTMLElement>('.hero__title')!
  const titleWords = title.querySelectorAll<HTMLElement>('.w > span')
  const sub = document.querySelector<HTMLElement>('.hero__sub')!
  const subText = sub.textContent || ''
  sub.textContent = ''
  gsap.set(titleWords, { yPercent: 115, rotate: 7, transformOrigin: '0% 100%' })
  gsap.set('.hero__list li, .hero__scroll', { opacity: 0, y: 10 })

  await new Promise((r) => setTimeout(r, 650))
  document.body.classList.add('is-entering')
  const tl = gsap.timeline({
    onComplete: () => {
      document.body.classList.remove('is-loading')
      lenis?.start()
    },
  })
  tl.to(stage.hero, { dot: 15, duration: 0.35, ease: 'power2.in' })
    .to(stage.hero, { reveal: 1, duration: 1.25, ease: 'expo.inOut' })
    .add(() => sections.start(), '-=0.5')
    .to(stage.hero, { fill: 1, duration: 1.1, ease: 'power2.inOut' }, '-=0.35')
    .to(titleWords, { yPercent: 0, rotate: 0, duration: 1.2, ease: 'expo.out', stagger: 0.07 }, '-=0.8')
    .add(() => void typeText(sub, subText), '-=0.9')
    .to('.hero__list li', { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', stagger: 0.05 }, '-=0.9')
    .to('.hero__scroll', { opacity: 0.6, y: 0, duration: 0.8, ease: 'expo.out' }, '-=0.6')
}

boot()
