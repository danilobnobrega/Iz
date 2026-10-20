import './m.css'
import * as THREE from 'three'
import gsap from 'gsap'
import Lenis from 'lenis'
import { GlyphAtlas, TextBlock, splitGlyphs } from './gl/Glyphs'
import { World, Photo, rectOf, collapse } from './gl/World'

// Proposta M. Uma família:
//  · títulos e fotos no mesmo pipeline WebGL, sob o mesmo acabamento de lente
//  · texto entra por letra ou por linha, dentro da própria célula, contorno antes do preenchimento
//  · fotos viajam entre lugares da página curvando como papel (atraso por vértice)
//  · o cursor revela o contorno das letras e ondula o quadro inteiro

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.85 })
lenis?.stop()

const INK = '#1a1612'
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const pinned = (el: Element) => {
  const r = el.getBoundingClientRect()
  return clamp(-r.top / Math.max(1, r.height - window.innerHeight))
}
// quanto um elemento já entrou na tela: 0 encostando embaixo, 1 a `span` telas depois
const entered = (el: Element, span = 0.75) => clamp((window.innerHeight - el.getBoundingClientRect().top) / (window.innerHeight * span))
const stepped = (v: number, n: number) => {
  const x = v * (n - 1)
  const k = Math.min(Math.floor(x), n - 2)
  return k + smooth(0.25, 0.75, x - k)
}
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const anchor = (key: string) => $(`[data-a="${key}"]`)

async function boot() {
  const canvas = $<HTMLCanvasElement>('.m-gl')
  const world = new World(canvas, '#ebe4d8')
  const loadN = $('.m-load__n')
  const prog = { v: 0 }
  const setLoad = (p: number) => gsap.to(prog, { v: p * 100, duration: 0.5, onUpdate: () => void (loadN.textContent = String(Math.round(prog.v))) })

  // fontes antes de medir qualquer coisa
  await document.fonts.load("300 100px 'Fraunces Variable'")
  await document.fonts.load("italic 300 100px 'Fraunces Variable'")
  await document.fonts.ready
  setLoad(0.2)

  // títulos
  const titleEls = Array.from(document.querySelectorAll<HTMLElement>('[data-t]'))
  const keys = new Set<string>()
  titleEls.forEach((el) => splitGlyphs(el).forEach((k) => keys.add(k)))
  const atlas = new GlyphAtlas()
  atlas.build(keys)
  setLoad(0.45)
  const T: Record<string, TextBlock> = {}
  for (const el of titleEls) {
    const tb = new TextBlock(el, atlas, el.dataset.color || INK, { mode: Number(el.dataset.mode || 0), margin: el.dataset.mode === '1' ? 0.55 : 0.32 })
    T[el.dataset.t!] = tb
    world.addText(tb)
  }
  // o Íz do rodapé é preenchido pela foto do salão
  const markEl = $('[data-t="mark"]')
  const markTex = await new THREE.TextureLoader().loadAsync(markEl.dataset.img!)
  markTex.colorSpace = THREE.NoColorSpace
  const mu = T.mark.mesh.material.uniforms
  mu.tImg.value = markTex
  mu.uImgMix.value = 1
  mu.uImgAspect.value = (markTex.image as HTMLImageElement).width / (markTex.image as HTMLImageElement).height

  // fotos
  const hero = await world.photo('/img/iz_unnamed.webp')
  const pr: Photo[] = []
  for (let i = 0; i < 4; i++) pr.push(await world.photo(anchor('p' + i).dataset.src!))
  const casas: Photo[] = []
  for (let i = 0; i < 7; i++) casas.push(await world.photo(anchor('th' + i).dataset.src!))
  const bts = await world.photo(anchor('bts').dataset.src!)
  setLoad(1)
  hero.mesh.renderOrder = 1

  // palavras da origem (texto corrido continua HTML)
  const lead = $('.m-lead')
  lead.innerHTML = (lead.textContent || '').trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ')
  const leadWords = Array.from(lead.querySelectorAll<HTMLElement>('.w'))
  const origem = $('.m-origem')
  const metas = Array.from(document.querySelectorAll<HTMLElement>('.m-meta'))
  const header = $('.m-h')
  document.querySelectorAll<HTMLElement>('.m-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))

  // cursor
  const cursor = $('.m-cursor')
  let mx = -999
  let my = -999
  let cx = -999
  let cy = -999
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })
  const titlesOver = () => titleEls.some((el) => {
    const r = el.getBoundingClientRect()
    return mx > r.left - 20 && mx < r.right + 20 && my > r.top && my < r.bottom
  })

  // miniaturas das casas levam até a casa
  const casasSec = $('.m-casas')
  document.querySelectorAll<HTMLElement>('.m-th').forEach((b, i) =>
    b.addEventListener('click', () => {
      const top = casasSec.getBoundingClientRect().top + window.scrollY
      const y = top + (casasSec.offsetHeight - window.innerHeight) * (i / 6)
      lenis ? lenis.scrollTo(y, { duration: 1.6 }) : window.scrollTo(0, y)
    }),
  )

  // relayout dos títulos quando o tamanho muda
  let rw = window.innerWidth
  window.addEventListener('resize', () => {
    world.resize()
    if (window.innerWidth !== rw) {
      rw = window.innerWidth
      Object.values(T).forEach((t) => t.layout())
    }
  })

  // estado da abertura
  const intro = { photo: 0, title: 0, done: false }
  const heroSec = $('.m-hero')
  const quoteSec = $('.m-quote')
  const prRows = Array.from(document.querySelectorAll<HTMLElement>('.m-pr'))
  const btsSec = $('.m-bts')
  const trabSec = $('.m-trab')
  const foot = $('.m-f')
  let lastActive = -1

  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const H = window.innerHeight
    cx += (mx - cx) * 0.22
    cy += (my - cy) * 0.22
    cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`
    cursor.classList.toggle('on-title', titlesOver())

    // ---- abertura → origem ----
    const hp = pinned(heroSec)
    const full = rectOf(anchor('hero-full'))
    const portrait = rectOf(anchor('hero-portrait'))
    if (!intro.done) {
      hero.from = collapse(full)
      hero.to = full
      hero.p = intro.photo
      hero.lift = 0
      hero.skew = 0
    } else {
      hero.from = full
      hero.to = portrait
      hero.p = smooth(0.12, 0.55, hp)
      hero.lift = 280
      hero.skew = 0
    }
    hero.zoom = 1 + 0.08 * (1 - intro.photo)
    T.hero.prog = intro.title * (1 - smooth(0.02, 0.16, hp))
    T.hero.dir = hp > 0.01 ? -1 : 1
    const lit = smooth(0.5, 0.95, hp) * leadWords.length
    leadWords.forEach((w, i) => w.classList.toggle('is-lit', i < lit))
    origem.style.opacity = String(smooth(0.42, 0.55, hp))
    header.classList.toggle('on-dark', hp < 0.12)

    // ---- citação: entra por linha, contorno primeiro ----
    T.quote.prog = entered(quoteSec.querySelector('.m-t')!, 0.9)

    // ---- princípios ----
    prRows.forEach((row, i) => {
      const e = entered(row, 0.95)
      T['p' + i].prog = e
      const a = rectOf(anchor('p' + i))
      pr[i].from = collapse(a)
      pr[i].to = a
      pr[i].p = smooth(0.15, 0.9, e)
      pr[i].skew = i % 2
    })

    // ---- casas: a foto sai da miniatura e voa até o quadro grande ----
    const cp = pinned(casasSec)
    const pos = stepped(cp, 7)
    const big = rectOf(anchor('casa-big'))
    const inCasas = casasSec.getBoundingClientRect().top < H && casasSec.getBoundingClientRect().bottom > 0
    const active = Math.round(pos)
    casas.forEach((ph, i) => {
      // a que sai e a que entra se cruzam no ar: o quadro grande nunca fica vazio
      const open = 1 - smooth(0.12, 1.0, Math.abs(pos - i))
      ph.from = rectOf(anchor('th' + i))
      ph.to = big
      ph.p = inCasas ? open : 0
      ph.lift = 320
      ph.skew = i % 2
      ph.dim = 0.55 + 0.45 * Math.max(open, cp === 0 ? 1 : 0)
      ph.mesh.renderOrder = 2 + open * 2
      const tb = T['c' + i]
      // o nome que sai termina antes de o próximo entrar
      tb.prog = 1 - smooth(0, 0.5, Math.abs(pos - i))
      tb.dir = pos > i ? -1 : 1
    })
    if (active !== lastActive) {
      lastActive = active
      metas.forEach((m, j) => m.classList.toggle('is-on', j === active))
    }

    // ---- bastidores ----
    const ba = rectOf(anchor('bts'))
    bts.from = collapse(ba)
    bts.to = ba
    bts.p = smooth(0, 0.85, entered(btsSec, 1.1))
    bts.dim = 0.62
    bts.lift = 0
    T.bts.prog = smooth(0.35, 1, entered(btsSec, 1.1))
    const bR = btsSec.getBoundingClientRect()
    if (bR.top < 60 && bR.bottom > 60) header.classList.add('on-dark')

    // ---- trabalhe, rodapé ----
    T.trab.prog = entered(trabSec.querySelector('.m-t')!, 0.9)
    T.mark.prog = entered(foot, 0.85)
    const mr = T.mark.el.getBoundingClientRect()
    mu.uImgRect.value.set(mr.left, mr.top, mr.width, mr.height)

    world.render(mx, my, lenis ? lenis.velocity : 0)
  })
  gsap.ticker.lagSmoothing(0)

  document.querySelector('[data-top]')?.addEventListener('click', (e) => {
    e.preventDefault()
    lenis ? lenis.scrollTo(0, { duration: 2.4 }) : window.scrollTo(0, 0)
  })
  document.querySelectorAll<HTMLAnchorElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = $(a.getAttribute('href')!)
      lenis ? lenis.scrollTo(t, { duration: 2.4 }) : t.scrollIntoView()
    }),
  )

  // entrada
  $('.m-load').classList.add('is-done')
  document.body.classList.remove('is-loading')
  await gsap.to(intro, { photo: 1, duration: 2.2, ease: 'expo.inOut', delay: 0.2 })
  gsap.to(intro, { title: 1, duration: 2.4, ease: 'power2.out' })
  setTimeout(() => {
    intro.done = true
    lenis?.start()
  }, 600)
}

boot()

