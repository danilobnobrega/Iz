import './style.css'
import './fluido.css'
import * as THREE from 'three'
import gsap from 'gsap'
import Lenis from 'lenis'
import { InkStage, type Plate } from './gl/InkStage'
import { tickPointer } from './ui/pointer'
import { initCursor } from './ui/cursor'
import { splitWords, typeText } from './ui/text'
import { initClock, setAccent } from './ui/frame'
import { initRitual } from './ui/ritual'
import { initHovers } from './ui/hovers'

// Proposta E: o site inteiro acontece num quadro só. As fotografias ficam sob um fluido
// simulado na GPU; o cursor mexe nelas e cada capítulo novo entra como tinta.

type Chapter = {
  id?: string
  name: string
  img: string
  accent: string
  kind?: 'mark' | 'casa' | 'center'
  k?: string
  t: string
  b?: string
  cta?: string
}

const CHAPTERS: Chapter[] = [
  { id: 'hero', name: 'Abertura', img: '/img/iz_unnamed.webp', accent: '#E9E4D8', kind: 'mark', t: 'Íz', b: 'Grupo de gastronomia · Goiânia · desde 2015' },
  { id: 'origem', name: 'Origem', img: '/img/ian_neo.webp', accent: '#D98A5F', k: '01 — Origem', t: 'Dois amigos de infância. Um cozinheiro que <em>voltou pra casa.</em>', b: 'Ian Baiocchi e Domingos Ávila se conheceram no karatê. Ian cozinhou no D.O.M., no Maní, no El Celler de Can Roca e no Mugaritz. Voltou para Goiânia. Em 2016, Domingos virou sócio.' },
  { name: 'Origem', img: '/img/socios.webp', accent: '#D98A5F', kind: 'center', t: '“O caminho mais fácil para um cozinheiro talvez fosse <em>ficar em São Paulo.</em>”', b: 'Ian Baiocchi' },
  { id: 'pensam', name: 'Como pensamos', img: '/img/gra1.webp', accent: '#E3B341', k: '02 — Como pensamos', t: 'Cuidado, <em>não pompa.</em>', b: 'Reunião com o salão todo dia antes de abrir. Serviço leve, nunca descuidado.' },
  { name: 'Como pensamos', img: '/img/nip_pizza.webp', accent: '#E3B341', k: '02 — Como pensamos', t: 'A base é linguagem, <em>não regra.</em>', b: 'No nip, a Margherita é DOG: denominação de origem goiana.' },
  { name: 'Como pensamos', img: '/img/caviar.webp', accent: '#E3B341', k: '02 — Como pensamos', t: 'Local, <em>sem ser óbvio.</em>', b: 'Baru, cajuzinho do cerrado, baunilha do cerrado, jabuticaba. Quando conversam com o prato.' },
  { id: 'casas', name: 'Íz', img: '/img/iz_rest.webp', accent: '#C9A27E', kind: 'casa', k: '03 — Casas · #01', t: 'Íz', b: 'Contemporânea · 2015 · Setor Marista' },
  { name: '1929 Trattoria', img: '/img/t1929.webp', accent: '#9DB58A', kind: 'casa', k: '03 — Casas · #02', t: '1929', b: 'Trattoria · o ano da avó, Dona Colombina' },
  { name: 'Grá', img: '/img/gra2.webp', accent: '#8FC0DA', kind: 'casa', k: '03 — Casas · #03', t: 'Grá', b: 'Bistrô francês · 192 metros · Órion' },
  { name: 'Alata', img: '/img/nip_pistache.webp', accent: '#C4B2F0', kind: 'casa', k: '03 — Casas · #04', t: 'Alata', b: 'Sorvete artesanal' },
  { name: 'Fulles Kitchen', img: '/img/nip_polpetone.webp', accent: '#EE8A5C', kind: 'casa', k: '03 — Casas · #05', t: 'Fulles', b: 'Cozinha na lenha' },
  { name: 'Íz Hotel Conceito', img: '/img/iz_9.webp', accent: '#D8C9A8', kind: 'casa', k: '03 — Casas · #06', t: 'Hotel', b: 'Íz Hotel Conceito · restaurant with rooms · 3 suítes' },
  { name: 'nip', img: '/img/nip_fachada.webp', accent: '#F2C744', kind: 'casa', k: '03 — Casas · #07', t: 'nip', b: 'Not in Napoli · 2026 · Rua 1130' },
  { id: 'portras', name: 'Bastidores', img: '/img/ian_chef.webp', accent: '#EE7A4E', k: '04 — Bastidores', t: '445 pessoas. <em>50 mil clientes por mês.</em>', b: 'Padaria, açougue e confeitaria próprios abastecem as casas. O que chega à mesa começa muito antes da porta abrir.' },
  { id: 'trabalhe', name: 'Trabalhe conosco', img: '/img/trattoria.webp', accent: '#A9C7A0', k: '05 — Trabalhe conosco', t: '445 hoje. <em>520 em 2026.</em>', b: 'Cozinha, salão, bar, hotel, padaria e confeitaria, escritório.', cta: 'Quero trabalhar no Íz' },
  { id: 'fim', name: 'Canais oficiais', img: '/img/iz_unnamed.webp', accent: '#E9E4D8', kind: 'mark', t: 'Íz', b: 'Canais oficiais · Rua 1130, Setor Marista, Goiânia · Proposta não oficial, desenhada e desenvolvida por Danilo' },
]

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)

const lenis = reduce ? null : new Lenis({ lerp: 0.075, wheelMultiplier: 0.8 })
lenis?.stop()

function buildDom() {
  const wrap = document.querySelector<HTMLElement>('.ink__chapters')!
  const nav = document.querySelector<HTMLElement>('.ink__nav')!
  const scroll = document.querySelector<HTMLElement>('.ink__scroll')!
  scroll.style.height = `${CHAPTERS.length * 100}vh`
  const els = CHAPTERS.map((c, i) => {
    const el = document.createElement('section')
    el.className = `ch${c.kind ? ' ch--' + c.kind : ''}${c.kind === 'mark' ? ' ch--center' : ''}`
    if (c.id) el.id = c.id
    el.dataset.name = c.name
    el.innerHTML = `${c.k ? `<p class="t-label ch__k">${c.k}</p>` : ''}<h2 class="ch__t">${c.t}</h2>${c.b ? `<p class="ch__b">${c.b}</p>` : ''}${
      c.cta ? `<a class="pill ch__cta" href="#"><span class="pill__fill"></span><span class="pill__label">${c.cta}</span></a>` : ''
    }`
    // divide o título em palavras preservando o itálico
    const t = el.querySelector<HTMLElement>('.ch__t')!
    const parts = Array.from(t.childNodes)
    t.textContent = ''
    let n = 0
    parts.forEach((node) => {
      const holder = node.nodeType === Node.ELEMENT_NODE ? (node.cloneNode(false) as HTMLElement) : document.createElement('span')
      holder.textContent = node.textContent
      splitWords(holder, 'w').forEach((w) => w.style.setProperty('--i', String(n++)))
      if (node.nodeType === Node.ELEMENT_NODE) t.appendChild(holder)
      else while (holder.firstChild) t.appendChild(holder.firstChild)
    })
    wrap.appendChild(el)

    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.label = c.name
    b.setAttribute('aria-label', c.name)
    b.addEventListener('click', () => {
      if (lenis) lenis.scrollTo(i * window.innerHeight, { duration: 1.4 })
      else window.scrollTo(0, i * window.innerHeight)
    })
    nav.appendChild(b)
    return { el, tick: b }
  })
  return els
}

async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.gl')!
  const stage = new InkStage(canvas)
  const index = document.querySelector<HTMLElement>('.ficha__index')!
  const fname = document.querySelector<HTMLElement>('.ficha__name')!
  initClock()
  const els = buildDom()

  // placa escura inicial
  const black = new THREE.DataTexture(new Uint8Array([12, 11, 10, 255]), 1, 1)
  black.needsUpdate = true
  stage.setPlate({ tex: black, aspect: 1 })

  const cursor = initCursor()
  let hovers = (_: number) => {}
  gsap.ticker.add((time, dtMs) => {
    const dt = Math.min(dtMs / 1000, 0.05)
    lenis?.raf(time * 1000)
    tickPointer(dt)
    cursor(dt)
    hovers(dt)
    stage.render(dt, lenis ? lenis.velocity : 0)
  })
  gsap.ticker.lagSmoothing(0)

  // carrega as placas
  const loader = new THREE.TextureLoader()
  const unique = [...new Set(CHAPTERS.map((c) => c.img))]
  const plates = new Map<string, Plate>()
  let done = 0
  const shown = { v: 0 }
  await Promise.all([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, 1200)),
    ...unique.map(
      (src) =>
        new Promise<void>((resolve) =>
          loader.load(
            src,
            (tex) => {
              tex.colorSpace = THREE.NoColorSpace
              tex.minFilter = THREE.LinearMipmapLinearFilter
              tex.anisotropy = 4
              const img = tex.image as HTMLImageElement
              plates.set(src, { tex, aspect: img.width / img.height })
              gsap.to(shown, { v: (++done / unique.length) * 100, duration: 0.4, onUpdate: () => void (index.textContent = String(Math.round(shown.v)).padStart(3, '0')) })
              resolve()
            },
            undefined,
            () => resolve(),
          ),
        ),
    ),
  ])
  hovers = initHovers()

  window.addEventListener('resize', () => stage.resize())

  // capítulo ativo pelo scroll
  let current = -1
  const go = (i: number) => {
    if (i === current) return
    const dir = i > current ? 1 : -1
    current = i
    const c = CHAPTERS[i]
    els.forEach(({ el, tick }, j) => {
      el.classList.toggle('is-on', j === i)
      tick.classList.toggle('is-on', j === i)
    })
    const plate = plates.get(c.img)
    if (plate) stage.reveal(plate, dir)
    stage.dark = c.kind === 'mark' ? 0.7 : 1
    setAccent(c.accent)
    index.textContent = `${String(i + 1).padStart(2, '0')} / ${String(CHAPTERS.length).padStart(2, '0')}`
    typeText(fname, c.name)
    document.body.classList.toggle('show-hint', i === 0)
  }
  const onScroll = () => {
    const i = Math.max(0, Math.min(CHAPTERS.length - 1, Math.floor((window.scrollY + window.innerHeight * 0.5) / window.innerHeight)))
    go(i)
  }
  lenis?.on('scroll', onScroll)
  if (!lenis) window.addEventListener('scroll', onScroll, { passive: true })

  // o menu leva direto ao capítulo
  initRitual(lenis, (target) => Math.max(0, els.findIndex(({ el }) => el === target)) * window.innerHeight)

  document.body.classList.remove('is-loading')
  go(0)
  setTimeout(() => lenis?.start(), 1600)
}

boot()
