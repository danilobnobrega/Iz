import './editorial.css'
import Lenis from 'lenis'

// Proposta F: editorial. Pouco movimento, todo ele lento e preciso.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 })

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// botões: cópia do texto para o hover
document.querySelectorAll<HTMLElement>('.ed-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))

// [data-lines]: quebra o texto nas linhas reais da diagramação; cada linha sobe sozinha
function splitLines(el: HTMLElement) {
  if (!el.dataset.src) el.dataset.src = el.innerHTML
  const tmp = document.createElement('div')
  tmp.innerHTML = el.dataset.src
  el.innerHTML = ''
  const words: HTMLElement[] = []
  const walk = (node: Node, parent: HTMLElement) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        ;(child.textContent || '').split(/(\s+)/).forEach((part) => {
          if (!part) return
          if (/^\s+$/.test(part)) return void parent.appendChild(document.createTextNode(' '))
          const w = document.createElement('span')
          w.textContent = part
          parent.appendChild(w)
          words.push(w)
        })
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const clone = (child as HTMLElement).cloneNode(false) as HTMLElement
        parent.appendChild(clone)
        walk(child, clone)
      }
    })
  }
  walk(tmp, el)
  const lines: HTMLElement[][] = []
  let last = -1
  words.forEach((w) => {
    const top = Math.round(w.getBoundingClientRect().top)
    if (last < 0 || Math.abs(top - last) > 4) lines.push([])
    last = top
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
      let p = w.parentElement
      while (p && p !== el) {
        if (p.tagName === 'EM' || p.classList.contains('peek')) {
          const wrap = p.cloneNode(false) as HTMLElement
          wrap.appendChild(node)
          node = wrap
        }
        p = p.parentElement
      }
      inner.appendChild(node)
      if (j < ws.length - 1) inner.appendChild(document.createTextNode(' '))
    })
    ln.appendChild(inner)
    el.appendChild(ln)
  })
}

const io = new IntersectionObserver(
  (es) =>
    es.forEach((e) => {
      if (!e.isIntersecting) return
      e.target.classList.add('is-in')
      io.unobserve(e.target)
    }),
  { rootMargin: '0px 0px -12% 0px' },
)

// palavras com foto
const peek = document.querySelector<HTMLImageElement>('.ed-peek')!
function bindPeeks() {
  document.querySelectorAll<HTMLElement>('[data-peek]').forEach((el) => {
    if (el.dataset.bound) return
    el.dataset.bound = '1'
    el.addEventListener('pointerenter', () => {
      peek.src = el.dataset.peek || ''
      peek.classList.add('is-on')
    })
    el.addEventListener('pointerleave', () => peek.classList.remove('is-on'))
  })
}
let px = 0
let py = 0
let tx = 0
let ty = 0
window.addEventListener('pointermove', (e) => {
  tx = e.clientX
  ty = e.clientY
})

// menu
const body = document.body
const menuBtn = document.querySelector<HTMLButtonElement>('.ed-h__menu')!
const toggleMenu = (open = !body.classList.contains('menu-open')) => {
  body.classList.toggle('menu-open', open)
  menuBtn.setAttribute('aria-expanded', String(open))
  if (open) lenis?.stop()
  else lenis?.start()
}
menuBtn.addEventListener('click', () => toggleMenu())
window.addEventListener('keydown', (e) => e.key === 'Escape' && toggleMenu(false))
const menuFig = document.querySelector<HTMLElement>('.ed-menu__fig')!
const menuImg = menuFig.querySelector('img')!
document.querySelectorAll<HTMLElement>('.ed-menu__list li').forEach((li, i) => {
  li.querySelector('a')!.style.setProperty('--i', String(i))
  li.addEventListener('pointerenter', () => {
    menuFig.classList.remove('is-on')
    requestAnimationFrame(() => {
      menuImg.src = li.dataset.img || ''
      menuFig.classList.add('is-on')
    })
  })
})

// links internos
document.querySelectorAll<HTMLAnchorElement>('[data-scroll]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const t = document.querySelector<HTMLElement>(a.getAttribute('href') || '')
    if (!t) return
    e.preventDefault()
    const go = () => (lenis ? lenis.scrollTo(t, { duration: 1.8 }) : t.scrollIntoView())
    if (a.hasAttribute('data-close') && body.classList.contains('menu-open')) {
      toggleMenu(false)
      setTimeout(go, 350)
    } else go()
  }),
)

// imprensa: uma frase por vez
const quotes = Array.from(document.querySelectorAll<HTMLElement>('.ed-press__q'))
let qi = 0
setInterval(() => {
  quotes[qi].classList.remove('is-on')
  qi = (qi + 1) % quotes.length
  quotes[qi].classList.add('is-on')
}, 4800)

// elementos ligados ao scroll
const header = document.querySelector<HTMLElement>('.ed-h')!
const hero = document.querySelector<HTMLElement>('.ed-hero')!
const heroSticky = hero.querySelector<HTMLElement>('.ed-hero__sticky')!
const heroBy = hero.querySelector<HTMLElement>('.ed-hero__by')!
const casas = document.querySelector<HTMLElement>('.ed-casas')!
const track = casas.querySelector<HTMLElement>('.ed-casas__track')!
const cards = Array.from(track.querySelectorAll<HTMLElement>('.ed-casa'))
const bts = document.querySelector<HTMLElement>('.ed-bts')!
const btsImg = bts.querySelector<HTMLElement>('img')!
let lastY = 0

function frame(t: number) {
  lenis?.raf(t)
  const vw = window.innerWidth
  const vh = window.innerHeight

  // peek segue o cursor
  px += (tx - px) * 0.12
  py += (ty - py) * 0.12
  peek.style.transform = `translate(${px + 24}px, ${py - 130}px) rotate(${clamp((tx - px) * 0.06, -6, 6)}deg)`

  // abertura: a moldura vertical se abre até a tela inteira
  const hr = hero.getBoundingClientRect()
  const hp = clamp(-hr.top / (hr.height - vh))
  const e = ease(hp / 0.85)
  const fw = Math.min(vw * 0.3, vh * 0.56)
  const fh = Math.min(vh * 0.74, fw * 1.32)
  const x0 = (vw - fw) / 2
  const y0 = (vh - fh) / 2
  heroSticky.style.setProperty('--t', `${lerp(y0, 0, e)}px`)
  heroSticky.style.setProperty('--b', `${lerp(y0, 0, e)}px`)
  heroSticky.style.setProperty('--l', `${lerp(x0, 0, e)}px`)
  heroSticky.style.setProperty('--r', `${lerp(x0, 0, e)}px`)
  heroSticky.style.setProperty('--s', String(lerp(1.15, 1, e)))
  heroBy.style.opacity = String(1 - clamp(hp * 6))
  header.classList.toggle('on-image', hp > 0.55 && hr.bottom > 60)

  // cabeçalho some ao descer, volta ao subir
  const y = window.scrollY
  if (Math.abs(y - lastY) > 4) {
    if (!body.classList.contains('menu-open')) header.classList.toggle('is-hidden', y > lastY && y > hr.height - vh * 0.5)
    lastY = y
  }

  // casas: a fila corre de lado; a do centro ganha cor
  const cr = casas.getBoundingClientRect()
  const cp = clamp(-cr.top / (cr.height - vh))
  const maxX = track.scrollWidth - vw
  track.style.transform = `translate3d(${-cp * maxX}px, 0, 0)`
  for (const c of cards) {
    const r = c.getBoundingClientRect()
    const d = clamp(Math.abs(r.left + r.width / 2 - vw / 2) / (vw * 0.42))
    const k = 1 - d
    c.style.setProperty('--gs', String(1 - k))
    c.style.setProperty('--br', String(lerp(0.6, 1, k)))
    c.style.setProperty('--z', String(lerp(1.12, 1, k)))
    c.style.setProperty('--o', String(lerp(0.35, 1, k)))
  }

  // bastidores: paralaxe lenta
  const br = bts.getBoundingClientRect()
  if (br.bottom > 0 && br.top < vh) btsImg.style.transform = `translateY(${((br.top + br.height / 2 - vh / 2) / vh) * -8}%)`

  requestAnimationFrame(frame)
}

async function boot() {
  await document.fonts.ready
  document.querySelectorAll<HTMLElement>('[data-lines]').forEach(splitLines)
  bindPeeks()
  document.querySelectorAll('[data-lines], [data-r], [data-route]').forEach((el) => io.observe(el))
  document.querySelectorAll<HTMLElement>('.ed-route li').forEach((li, i) => li.style.setProperty('--i', String(i)))
  body.classList.remove('is-loading')
  requestAnimationFrame(frame)
  let rw = window.innerWidth
  window.addEventListener('resize', () => {
    if (window.innerWidth === rw) return
    rw = window.innerWidth
    document.querySelectorAll<HTMLElement>('[data-lines]').forEach((el) => {
      const was = el.classList.contains('is-in')
      splitLines(el)
      if (was) el.classList.add('is-in')
    })
    bindPeeks()
  })
}

boot()
