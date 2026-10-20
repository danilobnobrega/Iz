import './style.css'
import './horizontal.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { tickPointer } from './ui/pointer'
import { initCursor } from './ui/cursor'
import { initText, typeText } from './ui/text'
import { initClock, initSections } from './ui/frame'
import { initRitual } from './ui/ritual'
import { initHovers } from './ui/hovers'

// Proposta C: o site inteiro corre na horizontal. O scroll vertical vira deslocamento lateral.
gsap.registerPlugin(ScrollTrigger)

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const wide = matchMedia('(min-width: 861px)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)

const lenis = reduce ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 1 })
lenis?.stop()
lenis?.on('scroll', ScrollTrigger.update)

async function boot() {
  const track = document.querySelector<HTMLElement>('.h__track')!
  const bar = document.querySelector<HTMLElement>('.h__bar span')!
  const index = document.querySelector<HTMLElement>('.ficha__index')!
  initClock()

  const cursor = initCursor()
  let hovers = (_: number) => {}
  const skews = Array.from(document.querySelectorAll<HTMLElement>('[data-skew]'))
  let skew = 0
  gsap.ticker.add((time, dtMs) => {
    const dt = Math.min(dtMs / 1000, 0.05)
    lenis?.raf(time * 1000)
    tickPointer(dt)
    cursor(dt)
    hovers(dt)
    // imagens inclinam e esticam com a velocidade da rolagem
    const v = lenis ? lenis.velocity : 0
    skew += (Math.max(-14, Math.min(14, v * 0.35)) - skew) * (1 - Math.pow(0.002, dt))
    const s = `skewX(${-skew * 0.6}deg) scale(${1 + Math.abs(skew) * 0.006})`
    for (const el of skews) el.style.transform = s
  })
  gsap.ticker.lagSmoothing(0)

  // contador de carregamento sobre as imagens da página
  const imgs = Array.from(document.images)
  let loaded = 0
  const shown = { v: 0 }
  const bump = () =>
    gsap.to(shown, { v: (++loaded / imgs.length) * 100, duration: 0.4, onUpdate: () => void (index.textContent = String(Math.round(shown.v)).padStart(3, '0')) })
  await Promise.all([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, 1200)),
    ...imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          const done = () => {
            bump()
            resolve()
          }
          if (img.complete) return done()
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
        }),
    ),
  ])

  // trilho
  let tween: gsap.core.Tween | undefined
  if (wide) {
    tween = gsap.to(track, {
      x: () => -(track.scrollWidth - window.innerWidth),
      ease: 'none',
      scrollTrigger: {
        trigger: '.h',
        start: 'top top',
        end: () => '+=' + (track.scrollWidth - window.innerWidth),
        pin: true,
        scrub: true,
        invalidateOnRefresh: true,
        onUpdate: (self) => gsap.set(bar, { scaleX: self.progress }),
      },
    })
  }
  const ca = tween

  initText({ containerAnimation: ca })
  hovers = initHovers()
  const sections = initSections({ selector: '.h__track > .p', containerAnimation: ca })
  initRitual(lenis, (target) => {
    if (!tween) return target.getBoundingClientRect().top + window.scrollY
    const st = tween.scrollTrigger!
    return st.start + target.offsetLeft
  })

  // paralaxe lateral das imagens dentro de cada página
  document.querySelectorAll<HTMLElement>('[data-px]').forEach((el) => {
    const amt = Number(el.dataset.px)
    const img = el.querySelector('img')
    if (!img || !ca) return
    gsap.fromTo(
      img,
      { xPercent: -amt * 0.5, scale: 1.2 },
      { xPercent: amt * 0.5, scale: 1.2, ease: 'none', scrollTrigger: { trigger: el, containerAnimation: ca, start: 'left right', end: 'right left', scrub: true } },
    )
  })

  // casas: a foto abre de baixo pra cima e o nome desliza mais devagar que a página
  document.querySelectorAll<HTMLElement>('.p--casa').forEach((casa) => {
    const fig = casa.querySelector<HTMLElement>('.pc__img')!
    const name = casa.querySelector<HTMLElement>('.pc__name')!
    gsap.to(fig, {
      clipPath: 'inset(0% 0 0 0)',
      ease: 'none',
      scrollTrigger: { trigger: casa, containerAnimation: ca, start: ca ? 'left 85%' : 'top 85%', end: ca ? 'left 25%' : 'top 25%', scrub: true },
    })
    if (ca)
      gsap.fromTo(name, { xPercent: 18 }, { xPercent: -18, ease: 'none', scrollTrigger: { trigger: casa, containerAnimation: ca, start: 'left right', end: 'right left', scrub: true } })
  })

  // rota do Ian desenhada pelo scroll
  const path = document.querySelector<SVGPathElement>('.rota-h__svg path')!
  gsap.to(path, {
    strokeDashoffset: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.rota-h', containerAnimation: ca, start: ca ? 'left 85%' : 'top 85%', end: ca ? 'right 70%' : 'bottom 40%', scrub: true },
  })
  gsap.from('.rota-h__stops li', {
    opacity: 0,
    y: 10,
    stagger: 0.15,
    scrollTrigger: { trigger: '.rota-h', containerAnimation: ca, start: ca ? 'left 75%' : 'top 75%', end: ca ? 'right 60%' : 'bottom 40%', scrub: true },
  })

  // o Íz do fim cresce ao chegar
  gsap.from('.hf__mark', {
    yPercent: 40,
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.p--fim', containerAnimation: ca, start: ca ? 'left 90%' : 'top 90%', end: ca ? 'left 20%' : 'top 30%', scrub: true },
  })

  window.addEventListener('resize', () => ScrollTrigger.refresh())

  // entrada
  const letters = document.querySelectorAll<HTMLElement>('.hh__mark span')
  const kicker = document.querySelector<HTMLElement>('.hh__kicker')!
  const kickerText = kicker.textContent || ''
  kicker.textContent = ''
  gsap.set(letters, { yPercent: 105, rotate: 6, transformOrigin: '0% 100%' })
  gsap.set('.hh__mark', { overflow: 'hidden', paddingTop: '0.08em' })
  gsap.set('.hh__img', { clipPath: 'inset(100% 0 0 0)' })
  gsap.set('.hh__lede, .hh__scroll', { opacity: 0, y: 14 })
  document.body.classList.remove('is-loading')
  sections.start()
  gsap
    .timeline({ delay: 0.2, onComplete: () => lenis?.start() })
    .to(letters, { yPercent: 0, rotate: 0, duration: 1.4, ease: 'expo.out', stagger: 0.09 })
    .to('.hh__img', { clipPath: 'inset(0% 0 0 0)', duration: 1.3, ease: 'expo.inOut' }, 0.2)
    .add(() => void typeText(kicker, kickerText), 0.5)
    .to('.hh__lede, .hh__scroll', { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.1 }, 0.8)
}

boot()
