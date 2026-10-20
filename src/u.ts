import './u.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Lens, type Shot } from './gl/Lens'

// Proposta U — "Foco": o site se comporta como a lente de um fotógrafo de gastronomia.
// Toda foto tem profundidade real; o foco vai para onde o olho está, com a dinâmica de um autofoco;
// a câmera anda com o scroll e o texto também só fica nítido na linha de leitura.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.85 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!
const $$ = (s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<HTMLElement>(s))

const HOUSES = [
  { name: 'Íz', meta: 'Contemporânea · Setor Marista · desde 2015', shot: 'iz_unnamed', subject: '0.79,0.66' },
  { name: '1929 Trattoria', meta: 'Italiana · o ano da avó, Dona Colombina', shot: 't1929', subject: '0.5,0.62' },
  { name: 'Grá', meta: 'Bistrô francês · 192 metros acima de Goiânia', shot: 'gra2', subject: '0.5,0.6' },
  { name: 'Alata', meta: 'Sorvete artesanal', shot: 'nip_pistache', subject: '0.5,0.5' },
  { name: 'Fulles Kitchen', meta: 'Cozinha na lenha', shot: 'nip_polpetone', subject: '0.5,0.5' },
  { name: 'Íz Hotel', meta: 'Restaurant with rooms · três suítes', shot: 'iz_9', subject: '0.5,0.6' },
  { name: 'nip', meta: 'Not in Napoli · Rua 1130', shot: 'nip_fachada', subject: '0.5,0.55' },
]

function splitWords(el: HTMLElement, cls: string, inner: boolean) {
  const out: HTMLElement[] = []
  const walk = (node: Node, parent: Node) =>
    Array.from(node.childNodes).forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        ;(c.textContent || '').split(/(\s+)/).forEach((w) => {
          if (!w) return
          if (/^\s+$/.test(w)) return void parent.appendChild(document.createTextNode(' '))
          const s = document.createElement('span')
          s.className = cls
          if (inner) {
            const i = document.createElement('span')
            i.textContent = w
            s.appendChild(i)
          } else s.textContent = w
          s.style.setProperty('--i', String(out.length))
          parent.appendChild(s)
          out.push(s)
        })
      } else {
        const cl = (c as HTMLElement).cloneNode(false)
        parent.appendChild(cl)
        walk(c, cl)
      }
    })
  const tmp = el.cloneNode(true)
  el.innerHTML = ''
  walk(tmp, el)
  return out
}

async function boot() {
  await document.fonts.ready
  const lens = new Lens($<HTMLCanvasElement>('.u-gl'))

  // carregamento: odômetro de três dígitos
  const digits = $$('.u-load__n i')
  let loaded = 0
  const shotEls = $$('[data-shot]')
  const names = new Set([...shotEls.map((e) => e.dataset.shot!), ...HOUSES.map((h) => h.shot)])
  const setCount = (n: number) => {
    const s = String(Math.round(n)).padStart(3, '0')
    digits.forEach((d, i) => (d.textContent = s[i]))
  }
  await Promise.all(
    [...names].map((n) =>
      lens.load(n).then(() => {
        loaded++
        setCount((loaded / names.size) * 100)
      }),
    ),
  )
  const shots = new Map<HTMLElement, Shot>()
  for (const el of shotEls) shots.set(el, await lens.add(el))
  const hero = shots.get($('.u-hero__shot'))!
  const casasShot = shots.get($('.u-casas__shot'))!

  // texto
  $$('[data-words]').forEach((el) => splitWords(el, 'w', true))
  const readWords = $$('[data-read]').flatMap((el) => splitWords(el, 'rw', false))
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (!e.isIntersecting) return
        e.target.classList.add('is-in')
        io.unobserve(e.target)
      }),
    { rootMargin: '0px 0px -15% 0px' },
  )
  $$('[data-words]:not(.u-hero__t), [data-fade]').forEach((el) => io.observe(el))

  // fotos fora da abertura se revelam ao entrar
  const revealIo = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (!e.isIntersecting) return
        const s = shots.get(e.target as HTMLElement)
        if (s) {
          s.focus.reset(0.02)
          gsap.to(s, { show: 1, duration: 1.8, ease: 'power3.out' })
        }
        revealIo.unobserve(e.target)
      }),
    { rootMargin: '0px 0px -10% 0px' },
  )
  shotEls.filter((el) => el !== hero.el).forEach((el) => revealIo.observe(el))

  // casas: a lista e a troca por puxada de foco
  const rowsEl = $('.u-rows')
  HOUSES.forEach((h, i) => {
    const li = document.createElement('li')
    li.className = 'u-row'
    li.dataset.af = ''
    li.innerHTML = `<span class="u-row__n">${String(i + 1).padStart(2, '0')}</span><span class="u-row__name">${h.name}</span><span class="u-row__meta">${h.meta}</span>`
    rowsEl.appendChild(li)
  })
  const rows = $$('.u-row')
  let shown = 0
  let hoverRow = -1
  let pull: gsap.core.Timeline | null = null
  async function showHouse(i: number) {
    if (i === shown) return
    shown = i
    rows.forEach((r, k) => r.classList.toggle('is-on', k === i))
    const img = await lens.load(HOUSES[i].shot)
    if (shown !== i) return
    pull?.kill()
    // a lente abre e perde o foco, a casa troca dentro do desfoque, e o foco volta
    pull = gsap
      .timeline()
      .to(casasShot, { aperture: 70, exposure: 0.82, duration: 0.42, ease: 'power2.in' })
      .add(() => {
        casasShot.setImage(img)
        casasShot.subject = HOUSES[i].subject.split(',').map(Number) as [number, number]
        casasShot.focus.reset(0.05)
      })
      .to(casasShot, { aperture: 20, exposure: 1, duration: 1.1, ease: 'power3.out' })
  }
  rows[0].classList.add('is-on')
  rows.forEach((r, i) => {
    r.addEventListener('pointerenter', () => {
      hoverRow = i
      showHouse(i)
    })
    r.addEventListener('pointerleave', () => (hoverRow = -1))
  })
  const casasSec = $('.u-casas')

  // cursor: o ponto de autofoco
  const af = $('.u-af')
  let mx = window.innerWidth / 2
  let my = window.innerHeight / 2
  const box = { x: mx - 20, y: my - 20, w: 40, h: 40 }
  let afTarget: HTMLElement | null = null
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })
  $$('[data-af]').forEach((el) => {
    el.addEventListener('pointerenter', () => (afTarget = el))
    el.addEventListener('pointerleave', () => afTarget === el && (afTarget = null))
  })

  // navegação
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
  window.addEventListener('resize', () => lens.resize())

  const mouse = { x: 0, y: 0 }
  let ripple = 0
  let last = performance.now()
  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    const W = window.innerWidth
    const H = window.innerHeight
    mouse.x += ((mx / W - 0.5) * 2 - mouse.x) * 0.06
    mouse.y += ((my / H - 0.5) * 2 - mouse.y) * 0.06
    ripple += (clamp((lenis?.velocity ?? 0) * 0.0012, -0.035, 0.035) - ripple) * 0.1

    // casa ativa pela posição do scroll (o hover tem prioridade)
    const cr = casasSec.getBoundingClientRect()
    if (cr.top < H && cr.bottom > 0 && hoverRow < 0) {
      const p = clamp(-cr.top / (cr.height - H))
      showHouse(Math.min(HOUSES.length - 1, Math.floor(p * HOUSES.length)))
    }

    // texto: só a faixa de leitura fica nítida
    const line = H * 0.55
    readWords.forEach((w) => {
      const r = w.getBoundingClientRect()
      const k = clamp(Math.abs(r.top + r.height / 2 - line) / (H * 0.38))
      w.style.setProperty('--b', `${(k * k * 7).toFixed(2)}px`)
      w.style.setProperty('--o', (1 - k * 0.72).toFixed(3))
    })

    lens.render(dt, time, mouse, ripple)

    // ponto de autofoco: abraça o que for clicável; sobre uma foto, trava quando o foco assenta
    let tx = mx - 20
    let ty = my - 20
    let tw = 40
    let th = 40
    let lock = false
    if (afTarget) {
      const r = afTarget.getBoundingClientRect()
      tx = r.left - 10
      ty = r.top - 8
      tw = r.width + 20
      th = r.height + 16
      lock = true
    } else {
      const s = lens.shots.find((s) => s.hover && s.visible)
      if (s) {
        const settled = Math.abs(s.focus.yd) < 0.04 && Math.abs(s.focus.y - s.target) < 0.02
        const size = settled ? 30 : 46
        tx = mx - size / 2
        ty = my - size / 2
        tw = th = size
        lock = settled
      }
    }
    const k = afTarget ? 0.28 : 0.4
    box.x += (tx - box.x) * k
    box.y += (ty - box.y) * k
    box.w += (tw - box.w) * 0.22
    box.h += (th - box.h) * 0.22
    af.style.transform = `translate(${box.x}px, ${box.y}px)`
    af.style.width = `${box.w}px`
    af.style.height = `${box.h}px`
    af.classList.toggle('is-lock', lock)
  })
  gsap.ticker.lagSmoothing(0)

  // entrada: a sala surge fora de foco e a lente encontra a mesa
  document.body.classList.remove('is-loading')
  $('.u-load').classList.add('is-done')
  hero.focus.reset(0.0)
  hero.aperture = 110
  hero.exposure = 0
  gsap.set(['.u-h'], { opacity: 0 })
  gsap
    .timeline({ delay: 0.5 })
    .to(hero, { show: 1, duration: 0.01 }, 0)
    .to(hero, { exposure: 1, duration: 1.8, ease: 'power2.out' }, 0)
    .to(hero, { aperture: 26, duration: 3.2, ease: 'expo.inOut' }, 0.2)
    .add(() => $('.u-hero__t').classList.add('is-in'), 2.2)
    .to('.u-h', { opacity: 1, duration: 1.2, ease: 'power2.out' }, 2.6)
    .add(() => lenis?.start(), 2.4)
}

boot()
