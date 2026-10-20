import './fenda.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { MediaStage, type Media } from './gl/Media'

// Proposta L. Leis da família:
//  forma    — a fenda vertical: toda imagem nasce dela, toda troca fecha e abre por ela
//  tempo    — uma curva só (.35, 0, 0, 1) e nada termina parado no meio
//  imagem   — um shader só: curva com a velocidade, lente sob o cursor, mesmo grão
//  palavra  — sobe com leve rotação, sempre igual

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.85 })
lenis?.stop()

const EASE = 'power4.out'
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const pinned = (el: Element) => {
  const r = el.getBoundingClientRect()
  return clamp(-r.top / Math.max(1, r.height - window.innerHeight))
}
// avança em degraus: segura em cada inteiro e anda entre eles
const stepped = (v: number, n: number) => {
  const x = v * (n - 1)
  const k = Math.min(Math.floor(x), n - 2)
  const f = x - k
  return k + smooth(0.22, 0.78, f)
}

// ---------- palavras ----------
function splitWords(el: HTMLElement) {
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
      } else if ((child as HTMLElement).classList?.contains('nv-inl')) {
        parent.appendChild(child.cloneNode(true))
      } else {
        const clone = (child as HTMLElement).cloneNode(false) as HTMLElement
        parent.appendChild(clone)
        walk(child, clone)
      }
    })
  }
  const src = el.cloneNode(true)
  el.textContent = ''
  walk(src, el)
}
document.querySelectorAll<HTMLElement>('[data-split], [data-scrub]').forEach(splitWords)
document.querySelectorAll<HTMLElement>('.nv-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))

// ---------- odômetro ----------
document.querySelectorAll<HTMLElement>('[data-odo]').forEach((el) => {
  const digits = (el.dataset.odo || '0').split('')
  el.textContent = ''
  digits.forEach((d, i) => {
    const col = document.createElement('span')
    col.className = 'col'
    col.style.setProperty('--i', String(i))
    for (let k = 0; k <= 9; k++) {
      const s = document.createElement('span')
      s.textContent = String(k)
      col.appendChild(s)
    }
    col.dataset.d = d
    el.appendChild(col)
  })
})
const rollOdo = (el: HTMLElement, on: boolean) =>
  el.querySelectorAll<HTMLElement>('.col').forEach((c) => (c.style.transform = `translateY(${on ? -Number(c.dataset.d) * 0.9 : 0}em)`))

// ---------- texto decodificado (imprensa) ----------
const GLYPHS = 'abcdefghijklmnopqrstuvwxyzáéíóú'
function decode(el: HTMLElement, text: string) {
  const o = { p: 0 }
  gsap.to(o, {
    p: 1,
    duration: Math.max(0.8, text.length / 40),
    ease: 'none',
    onUpdate: () => {
      const n = o.p * text.length
      let out = ''
      for (let i = 0; i < text.length; i++) out += i < n - 3 || text[i] === ' ' ? text[i] : i < n ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : ''
      el.textContent = out
    },
    onComplete: () => void (el.textContent = text),
  })
}

async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>('.nv-gl')!
  const stage = new MediaStage(canvas)
  const load = document.querySelector<HTMLElement>('.nv-load')!
  const loadN = load.querySelector<HTMLElement>('.nv-load__n')!

  // carregamento real: fontes + texturas
  const figs = Array.from(document.querySelectorAll<HTMLElement>('[data-gl]'))
  let done = 0
  const shown = { v: 0 }
  const bump = () =>
    gsap.to(shown, {
      v: (++done / (figs.length + 1)) * 100,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate: () => {
        loadN.textContent = String(Math.round(shown.v)).padStart(3, '0')
        load.style.setProperty('--p', String(shown.v / 100))
      },
    })
  const fontsReady = document.fonts.ready.then(bump)
  const medias = await Promise.all(figs.map((f) => stage.add(f).then((m) => (bump(), m))))
  await fontsReady
  await new Promise((r) => setTimeout(r, 700))
  const byEl = new Map<HTMLElement, Media>(medias.map((m) => [m.el, m]))

  const hero = document.querySelector<HTMLElement>('.nv-hero')!
  const heroFig = hero.querySelector<HTMLElement>('.nv-hero__media')!
  const heroM = byEl.get(heroFig)!
  const heroText = hero.querySelector<HTMLElement>('.nv-hero__text')!
  const heroTitle = heroText.querySelector<HTMLElement>('[data-split]')!
  const origem = hero.querySelector<HTMLElement>('.nv-origem')!
  const leadWords = Array.from(origem.querySelectorAll<HTMLElement>('.nv-lead .wd, .nv-lead .nv-inl'))
  const header = document.querySelector<HTMLElement>('.nv-h')!

  const princ = document.querySelector<HTMLElement>('.nv-princ')!
  const steps = Array.from(princ.querySelectorAll<HTMLElement>('.nv-step'))
  const princM = Array.from(princ.querySelectorAll<HTMLElement>('.nv-princ__media figure')).map((f) => byEl.get(f)!)

  const casas = document.querySelector<HTMLElement>('.nv-casas')!
  const track = casas.querySelector<HTMLElement>('.nv-casas__track')!
  const names = Array.from(casas.querySelectorAll<HTMLElement>('.nv-name'))
  const casaM = Array.from(track.querySelectorAll<HTMLElement>('figure')).map((f) => byEl.get(f)!)

  const bts = document.querySelector<HTMLElement>('.nv-bts')!
  const btsM = byEl.get(bts.querySelector<HTMLElement>('.nv-bts__media')!)!

  // imagens que abrem ao entrar (as que não têm coreografia própria)
  const scripted = new Set<Media>([heroM, btsM, ...princM])
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        const el = e.target as HTMLElement
        const m = byEl.get(el)
        if (m && !scripted.has(m)) {
          if (e.isIntersecting) gsap.to(m, { reveal: 1, duration: 1.7, ease: 'expo.inOut', delay: Number(el.dataset.casa || 0) * 0.06 })
          return
        }
        if (e.isIntersecting) {
          el.classList.add('is-in')
          el.querySelectorAll<HTMLElement>('[data-odo]').forEach((o) => rollOdo(o, true))
          if (el.matches('[data-odo]')) rollOdo(el, true)
        }
      }),
    { rootMargin: '0px 0px -10% 0px' },
  )
  figs.forEach((f) => io.observe(f))
  document.querySelectorAll('[data-io], .nv-nums').forEach((el) => io.observe(el))

  // imprensa
  const quotes = [
    ['12º entre os 100 melhores restaurantes do Brasil.', 'Exame Casual, sobre o Íz'],
    ['Melhor restaurante de Goiânia.', 'Curta Mais, 2026'],
    ['Como dois jovens criaram um império gastronômico em Goiânia.', 'Forbes Brasil, 2025'],
  ]
  const pq = document.querySelector<HTMLElement>('.nv-press__q')!
  const ps = document.querySelector<HTMLElement>('.nv-press__s')!
  let qi = 0
  const nextQuote = () => {
    decode(pq, quotes[qi][0])
    ps.textContent = quotes[qi][1]
    qi = (qi + 1) % quotes.length
  }
  new IntersectionObserver((es) => es[0].isIntersecting && (nextQuote(), setInterval(nextQuote, 5200)), {}).observe(pq)

  // cursor
  const cursor = document.querySelector<HTMLElement>('.nv-cursor')!
  let mx = -100
  let my = -100
  let cx = -100
  let cy = -100
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })
  document.addEventListener('pointerover', (e) => {
    const t = e.target as HTMLElement
    cursor.classList.toggle('is-link', !!t.closest('a, button'))
    cursor.classList.toggle('is-media', !t.closest('a, button') && !!t.closest('[data-gl]'))
  })

  // botões magnéticos
  document.querySelectorAll<HTMLElement>('[data-magnet]').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect()
      gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.25, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.6, ease: EASE })
    })
    b.addEventListener('pointerleave', () => gsap.to(b, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.5)' }))
  })

  // volta ao começo pelo rodapé
  const bar = document.querySelector<HTMLElement>('.nv-f__bar')!
  let loopFill = 0
  let looping = false
  window.addEventListener(
    'wheel',
    (e) => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (window.scrollY < max - 4 || e.deltaY <= 0 || looping) return
      loopFill = Math.min(1, loopFill + e.deltaY / 1600)
      if (loopFill >= 1) {
        looping = true
        gsap.to(heroM, { reveal: 0, duration: 0 })
        lenis ? lenis.scrollTo(0, { immediate: true, force: true }) : window.scrollTo(0, 0)
        gsap.to(heroM, { reveal: 1, duration: 1.8, ease: 'expo.inOut', onComplete: () => void (looping = false) })
        heroTitle.classList.remove('is-in')
        setTimeout(() => heroTitle.classList.add('is-in'), 700)
        loopFill = 0
      }
    },
    { passive: true },
  )

  // ---------- quadro a quadro ----------
  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const W = window.innerWidth
    const H = window.innerHeight
    const mobile = W < 861
    cx += (mx - cx) * 0.2
    cy += (my - cy) * 0.2
    cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`
    loopFill *= 0.985
    bar.style.setProperty('--f', String(loopFill))

    // abertura: a foto em tela cheia encolhe até virar o retrato da origem
    const hp = pinned(hero)
    const dock = smooth(0.12, 0.5, hp)
    const card = mobile ? { x: W * 0.12, y: H * 0.56, w: W * 0.76, h: H * 0.36 } : { x: W * 0.6, y: H * 0.17, w: W * 0.32, h: H * 0.66 }
    heroFig.style.left = `${lerp(0, card.x, dock)}px`
    heroFig.style.top = `${lerp(0, card.y, dock)}px`
    heroFig.style.width = `${lerp(W, card.w, dock)}px`
    heroFig.style.height = `${lerp(H, card.h, dock)}px`
    heroM.zoom = lerp(1.0, 1.25, dock)
    heroText.style.opacity = String(1 - smooth(0.04, 0.18, hp))
    heroText.style.transform = `translateY(${smooth(0.04, 0.2, hp) * 40}px)`
    header.classList.toggle('on-dark', hp < 0.16)
    // origem: as palavras acendem conforme se rola; as fotos na frase abrem junto
    const lit = smooth(0.42, 0.92, hp) * leadWords.length
    leadWords.forEach((w, i) => w.classList.toggle('is-lit', i < lit))
    origem.style.opacity = String(smooth(0.3, 0.45, hp))

    // princípios: uma frase fecha numa fenda, a próxima abre dela
    const ps2 = stepped(pinned(princ), steps.length)
    steps.forEach((s, i) => {
      const open = 1 - smooth(0.0, 0.5, Math.abs(ps2 - i))
      s.style.setProperty('--c', `${(1 - open) * 50}%`)
      s.style.setProperty('--sx', String(0.92 + 0.08 * open))
      s.style.setProperty('--o', String(smooth(0.75, 1, open)))
      princM[i].reveal = open
    })

    // casas: a fila corre de lado e curva nas pontas; o nome do centro abre
    const cp = pinned(casas)
    track.style.transform = `translate3d(${-cp * (track.scrollWidth - W)}px, 0, 0)`
    const pos = stepped(cp, names.length)
    names.forEach((n, i) => {
      const open = 1 - smooth(0.0, 0.5, Math.abs(pos - i))
      n.style.setProperty('--c', `${(1 - open) * 50}%`)
      n.style.setProperty('--o', String(smooth(0.7, 1, open)))
    })
    for (const m of casaM) {
      const r = m.el.getBoundingClientRect()
      const dx = (r.left + r.width / 2 - W / 2) / W
      m.tilt = -dx * 0.9
      m.dim = lerp(1, 0.45, clamp(Math.abs(dx) * 2.4))
    }
    const cr = casas.getBoundingClientRect()
    if (cr.top < H * 0.5 && cr.bottom > H * 0.5) header.classList.add('on-dark')

    // bastidores: a foto abre em nove fendas enquanto entra
    const br = bts.getBoundingClientRect()
    btsM.reveal = smooth(0, 0.9, (H - br.top) / (H * 1.1))
    if (br.top < H * 0.5 && br.bottom > H * 0.5) header.classList.add('on-dark')

    stage.render(lenis ? lenis.velocity : 0)
  })
  gsap.ticker.lagSmoothing(0)

  window.addEventListener('resize', () => stage.resize())
  document.querySelector('[data-top]')?.addEventListener('click', (e) => {
    e.preventDefault()
    lenis ? lenis.scrollTo(0, { duration: 2.4 }) : window.scrollTo(0, 0)
  })
  document.querySelectorAll<HTMLAnchorElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = document.querySelector<HTMLElement>(a.getAttribute('href')!)
      if (t) lenis ? lenis.scrollTo(t, { duration: 2.4 }) : t.scrollIntoView()
    }),
  )

  // entrada: a linha do carregamento cresce até a altura toda e se abre na primeira foto
  const line = load.querySelector<HTMLElement>('.nv-load__line')!
  await gsap.to(line, { height: '100vh', duration: 0.7, ease: 'expo.inOut' })
  heroM.reveal = 1 / window.innerWidth
  load.classList.add('is-done')
  document.body.classList.remove('is-loading')
  gsap.to(heroM, { reveal: 1, duration: 1.9, ease: 'expo.inOut' })
  setTimeout(() => heroTitle.classList.add('is-in'), 1000)
  heroText.querySelectorAll('[data-fade]').forEach((el) => setTimeout(() => el.classList.add('is-in'), 1300))
  setTimeout(() => lenis?.start(), 1600)
}

boot()
