import './style.css'
import './indice.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { pointer, tickPointer } from './ui/pointer'
import { initCursor } from './ui/cursor'
import { initText, splitWords, typeText } from './ui/text'
import { initClock, initSections, setAccent } from './ui/frame'
import { initRitual } from './ui/ritual'
import { initHovers } from './ui/hovers'

// Proposta D: a abertura é o índice das casas; o resto do site são folhas que se empilham.
gsap.registerPlugin(ScrollTrigger)

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const wide = matchMedia('(min-width: 861px)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)

const lenis = reduce ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 })
lenis?.stop()
lenis?.on('scroll', ScrollTrigger.update)

async function boot() {
  const index = document.querySelector<HTMLElement>('.ficha__index')!
  initClock()

  const list = document.querySelector<HTMLElement>('.idx')!
  const rows = Array.from(list.querySelectorAll<HTMLElement>('.idx__row'))

  const cursor = initCursor()
  let hovers = (_: number) => {}
  let bx = 50
  let by = 50
  gsap.ticker.add((time, dtMs) => {
    const dt = Math.min(dtMs / 1000, 0.05)
    lenis?.raf(time * 1000)
    tickPointer(dt)
    cursor(dt)
    hovers(dt)
    // a foto dentro das letras desliza no sentido contrário do cursor
    const k = 1 - Math.pow(0.004, dt)
    bx += ((1 - pointer.x / window.innerWidth) * 100 - bx) * k
    by += ((1 - pointer.y / window.innerHeight) * 100 - by) * k
    list.style.setProperty('--bx', bx.toFixed(2) + '%')
    list.style.setProperty('--by', by.toFixed(2) + '%')
  })
  gsap.ticker.lagSmoothing(0)

  // pré-carrega as fotos das casas
  const srcs = rows.map((r) => r.dataset.img!)
  let n = 0
  const shown = { v: 0 }
  await Promise.all([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, 1100)),
    ...srcs.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = img.onerror = () => {
            gsap.to(shown, { v: (++n / srcs.length) * 100, duration: 0.4, onUpdate: () => void (index.textContent = String(Math.round(shown.v)).padStart(3, '0')) })
            resolve()
          }
          img.src = src
        }),
    ),
  ])

  initText()
  hovers = initHovers()
  const sections = initSections()
  initRitual(lenis)

  let openRow: HTMLElement | null = null

  // hover nas linhas: a linha ativa sai da posição do cursor numa divisão fixa em 7 faixas,
  // assim o acordeão não troca a linha sob o cursor enquanto os tamanhos mudam
  let active: HTMLElement | null = null
  const activate = (row: HTMLElement | null) => {
    if (row === active) return
    active = row
    rows.forEach((r) => r.classList.toggle('is-on', r === row))
    list.classList.toggle('has-hover', !!row)
    if (row) list.style.setProperty('--tpl', rows.map((r) => (r === row ? '3.6fr' : '0.57fr')).join(' '))
    else list.style.removeProperty('--tpl')
    setAccent(row ? row.dataset.accent || '#111110' : '#111110')
  }
  list.addEventListener('pointermove', (e) => {
    if (openRow) return
    const r = list.getBoundingClientRect()
    const i = Math.max(0, Math.min(rows.length - 1, Math.floor(((e.clientY - r.top) / r.height) * rows.length)))
    activate(rows[i])
  })
  list.addEventListener('pointerleave', () => activate(null))

  // abrir casa: a foto se abre a partir da própria linha
  const ov = document.querySelector<HTMLElement>('.idx-open')!
  const ovImg = ov.querySelector<HTMLElement>('.idx-open__img')!
  const ovN = ov.querySelector<HTMLElement>('.idx-open__n')!
  const ovName = ov.querySelector<HTMLElement>('.idx-open__name')!
  const ovMeta = ov.querySelector<HTMLElement>('.idx-open__meta')!
  const rectClip = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return `inset(${r.top}px ${window.innerWidth - r.right}px ${window.innerHeight - r.bottom}px ${r.left}px)`
  }
  const open = (row: HTMLElement) => {
    openRow = row
    lenis?.stop()
    ov.classList.add('is-open')
    ovImg.style.backgroundImage = `url('${row.dataset.img}')`
    ovName.textContent = row.dataset.full || ''
    const words = splitWords(ovName, 'w')
    ovN.textContent = ''
    ovMeta.textContent = ''
    gsap.set(words, { yPercent: 115, rotate: 7 })
    gsap
      .timeline()
      .fromTo(ovImg, { clipPath: rectClip(row) }, { clipPath: 'inset(0px 0px 0px 0px)', duration: 1.05, ease: 'expo.inOut' })
      .to(words, { yPercent: 0, rotate: 0, duration: 1.1, ease: 'expo.out', stagger: 0.06 }, '-=0.35')
      .add(() => {
        typeText(ovN, row.dataset.n || '')
        typeText(ovMeta, row.dataset.meta || '')
      }, '-=0.9')
  }
  const close = () => {
    if (!openRow) return
    const row = openRow
    openRow = null
    gsap.to(ovName.querySelectorAll('.w > span'), { yPercent: 115, duration: 0.4, ease: 'power2.in' })
    gsap.to(ovImg, {
      clipPath: rectClip(row),
      duration: 0.9,
      delay: 0.15,
      ease: 'expo.inOut',
      onComplete: () => {
        ov.classList.remove('is-open')
        lenis?.start()
      },
    })
  }
  list.addEventListener('click', (e) => {
    e.preventDefault()
    if (active) open(active)
  })
  ov.querySelector('.idx-open__close')!.addEventListener('click', close)
  window.addEventListener('keydown', (e) => e.key === 'Escape' && close())

  // folhas que se empilham: cada folha gruda quando o fim dela chega na tela,
  // e a anterior encolhe e escurece enquanto a próxima sobe por cima
  const sheets = Array.from(document.querySelectorAll<HTMLElement>('.sheet'))
  const setStick = () => sheets.forEach((s) => s.style.setProperty('--stick', `${Math.min(0, window.innerHeight - s.offsetHeight)}px`))
  if (wide) {
    setStick()
    sheets.forEach((s, i) => {
      const shade = document.createElement('div')
      shade.className = 'sheet__shade'
      s.appendChild(shade)
      const next = sheets[i + 1]
      if (!next) return
      const wrap = s.querySelector('.wrap')
      gsap
        .timeline({ scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true } })
        .to(wrap, { scale: 0.93, ease: 'none' }, 0)
        .to(shade, { opacity: 0.5, ease: 'none' }, 0)
    })
  }
  window.addEventListener('resize', () => {
    if (wide) setStick()
    ScrollTrigger.refresh()
  })

  // entrada: os nomes sobem linha por linha
  const names = rows.map((r) => r.querySelector<HTMLElement>('.idx__name')!)
  const nums = rows.map((r) => r.querySelector<HTMLElement>('.idx__n')!)
  const top = document.querySelector<HTMLElement>('[data-type-intro]')!
  const topText = top.textContent || ''
  top.textContent = ''
  gsap.set(names, { yPercent: 110 })
  gsap.set(nums, { opacity: 0 })
  document.body.classList.remove('is-loading')
  sections.start()
  gsap
    .timeline({ delay: 0.15, onComplete: () => lenis?.start() })
    .to(names, { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.07, clearProps: 'transform' })
    .to(nums, { opacity: 1, duration: 0.6, stagger: 0.05 }, 0.4)
    .add(() => void typeText(top, topText), 0.2)
}

boot()
