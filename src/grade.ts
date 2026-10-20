import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { Grid } from './gl/Grid'
import { tickPointer } from './ui/pointer'
import { initCursor } from './ui/cursor'
import { initText, splitWords, typeText } from './ui/text'
import { initClock, initSections } from './ui/frame'
import { initRitual } from './ui/ritual'
import { initHovers } from './ui/hovers'

// Proposta B: grade infinita de fotos, arrastável, que abre cada casa em tela cheia.
gsap.registerPlugin(ScrollTrigger)

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)

const lenis = reduce ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 })
lenis?.stop()
lenis?.on('scroll', ScrollTrigger.update)

async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.gl')!
  const hero = document.querySelector<HTMLElement>('#hero')!
  const grid = new Grid(canvas, hero)
  const index = document.querySelector<HTMLElement>('.ficha__index')!
  initClock()

  const shown = { v: 0 }
  const setCount = (p: number) =>
    gsap.to(shown, { v: p * 100, duration: 0.6, ease: 'power2.out', onUpdate: () => void (index.textContent = String(Math.round(shown.v)).padStart(3, '0')) })

  const cursor = initCursor()
  let hovers = (_: number) => {}
  gsap.ticker.add((time, dtMs) => {
    const dt = Math.min(dtMs / 1000, 0.05)
    lenis?.raf(time * 1000)
    tickPointer(dt)
    cursor(dt)
    hovers(dt)
    grid.render(dt)
  })
  gsap.ticker.lagSmoothing(0)

  await document.fonts.ready
  const minTime = new Promise((r) => setTimeout(r, 1200))
  await grid.load((p) => setCount(p * 0.96))
  await minTime
  setCount(1)

  initText()
  hovers = initHovers()
  const sections = initSections()
  initRitual(lenis)

  // ao sair do hero, a grade recua e some
  ScrollTrigger.create({
    trigger: hero,
    start: 'top top',
    end: 'bottom top',
    scrub: true,
    onUpdate: (self) => {
      grid.zoom = 1 - self.progress * 0.35
    },
    onToggle: (self) => (grid.visible = self.isActive || self.progress < 1),
  })
  ScrollTrigger.create({ trigger: hero, start: 'top bottom', end: 'bottom top', onToggle: (self) => (grid.visible = self.isActive) })

  window.addEventListener('resize', () => {
    grid.resize()
    ScrollTrigger.refresh()
  })

  // abrir / fechar casa
  const panel = document.querySelector<HTMLElement>('.casa-open')!
  const pn = panel.querySelector<HTMLElement>('.casa-open__n')!
  const pname = panel.querySelector<HTMLElement>('.casa-open__name')!
  const pmeta = panel.querySelector<HTMLElement>('.casa-open__meta')!
  const ui = document.querySelector<HTMLElement>('.grade__ui')!
  grid.onOpen = (tile) => {
    if (tile) {
      lenis?.stop()
      gsap.to(ui, { opacity: 0, duration: 0.4 })
      panel.classList.add('is-open')
      pname.textContent = tile.casa
      const words = splitWords(pname, 'w')
      gsap.fromTo(words, { yPercent: 115, rotate: 7 }, { yPercent: 0, rotate: 0, duration: 1.1, ease: 'expo.out', stagger: 0.06, delay: 0.55 })
      pn.textContent = ''
      pmeta.textContent = ''
      gsap.delayedCall(0.7, () => {
        typeText(pn, tile.n)
        typeText(pmeta, tile.meta)
      })
    } else {
      panel.classList.remove('is-open')
      gsap.to(ui, { opacity: 1, duration: 0.6, delay: 0.5 })
      lenis?.start()
    }
  }
  panel.querySelector('.casa-open__close')!.addEventListener('click', () => grid.close())
  window.addEventListener('keydown', (e) => e.key === 'Escape' && grid.close())

  // entrada
  const titleWords = document.querySelectorAll<HTMLElement>('.grade__title .w > span')
  const hint = document.querySelector<HTMLElement>('.grade__hint')!
  gsap.set(titleWords, { yPercent: 115, rotate: 7, transformOrigin: '0% 100%' })
  gsap.set(hint, { opacity: 0 })
  await new Promise((r) => setTimeout(r, 400))
  document.body.classList.remove('is-loading')
  sections.start()
  grid.intro()
  gsap.to(titleWords, { yPercent: 0, rotate: 0, duration: 1.3, ease: 'expo.out', stagger: 0.08, delay: 0.9 })
  gsap.to(hint, { opacity: 1, duration: 0.8, delay: 1.5, onComplete: () => lenis?.start() })
}

boot()
