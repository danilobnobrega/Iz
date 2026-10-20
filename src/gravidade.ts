import './gravidade.css'
import Matter from 'matter-js'
import Lenis from 'lenis'

// Proposta I: os títulos são letras com peso. Caem, quicam e se encaixam;
// ao avançar, a frase se solta e despenca, e a próxima cai no lugar.
// Rolando para cima, a gravidade inverte.

const { Engine, Bodies, Body, Composite } = Matter

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 })
lenis?.stop()

type Piece = {
  el: HTMLElement
  body: Matter.Body
  tx: number // centro de repouso
  ty: number
  mode: 'fall-in' | 'spring' | 'fall-out'
  dir: number
}

const engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } })
const NO_SELF = -1 // peças não colidem entre si, só com o cursor
const pieces: Piece[] = []

const cursor = Bodies.circle(-500, -500, 46, { inertia: Infinity, frictionAir: 0, collisionFilter: { group: 0 } })
Composite.add(engine.world, cursor)

const sections = Array.from(document.querySelectorAll<HTMLElement>('.gv-s'))

// letras: cada uma vira um elemento próprio; palavras não quebram no meio
function splitLetters(el: HTMLElement) {
  const walk = (node: Node, parent: HTMLElement) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        ;(child.textContent || '').split(/(\s+)/).forEach((part) => {
          if (!part) return
          if (/^\s+$/.test(part)) return void parent.appendChild(document.createTextNode(' '))
          const wd = document.createElement('span')
          wd.className = 'gv-wd'
          for (const c of part) {
            const ch = document.createElement('span')
            ch.className = 'gv-ch'
            ch.textContent = c
            ch.dataset.phys = ''
            wd.appendChild(ch)
          }
          parent.appendChild(wd)
        })
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
document.querySelectorAll<HTMLElement>('[data-letters]').forEach(splitLetters)
document.querySelectorAll<HTMLElement>('.gv-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))
document.querySelector<HTMLElement>('.gv-scroll')!.style.height = `${sections.length * 100}vh`

function release(sec: HTMLElement, dir: number) {
  sec.classList.remove('is-on')
  for (const p of pieces) {
    if (p.el.closest('.gv-s') !== sec || p.mode === 'fall-out') continue
    p.mode = 'fall-out'
    p.dir = dir
    // um empurrão desigual pra frase se desmanchar
    Body.setVelocity(p.body, { x: p.body.velocity.x + (Math.random() - 0.5) * 6, y: p.body.velocity.y - dir * (2 + Math.random() * 5) })
    Body.setAngularVelocity(p.body, (Math.random() - 0.5) * 0.25)
  }
}

function enter(sec: HTMLElement, dir: number) {
  // remove peças antigas desta seção que ainda estejam caindo
  for (let i = pieces.length - 1; i >= 0; i--)
    if (pieces[i].el.closest('.gv-s') === sec) {
      Composite.remove(engine.world, pieces[i].body)
      pieces.splice(i, 1)
    }
  const els = Array.from(sec.querySelectorAll<HTMLElement>('[data-phys]'))
  els.forEach((el) => (el.style.transform = ''))
  sec.classList.add('is-live')
  const vh = window.innerHeight
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect()
    const tx = r.left + r.width / 2
    const ty = r.top + r.height / 2
    const isCard = el.classList.contains('gv-card')
    const w = isCard ? r.width * 0.96 : r.width * 0.9
    const h = isCard ? r.height * 0.96 : r.height * 0.6
    // nasce fora da tela, do lado de onde vem a gravidade, em fila irregular
    const delay = (i / Math.max(1, els.length)) * vh * 0.9 + Math.random() * vh * 0.25
    const sy = dir > 0 ? -vh * 0.15 - delay : vh * 1.15 + delay
    const body = Bodies.rectangle(tx + (Math.random() - 0.5) * 80, sy, Math.max(4, w), Math.max(4, h), {
      frictionAir: 0.004,
      restitution: 0.3,
      angle: (Math.random() - 0.5) * (isCard ? 0.5 : 1.2),
      collisionFilter: { group: NO_SELF },
      density: isCard ? 0.0006 : 0.001,
    })
    Body.setVelocity(body, { x: 0, y: dir * (4 + Math.random() * 3) })
    Composite.add(engine.world, body)
    pieces.push({ el, body, tx, ty, mode: 'fall-in', dir })
    // garante que a peça só seja desenhada depois de posicionada
    el.style.transform = `translate(${body.position.x - tx}px, ${body.position.y - ty}px)`
  })
  setTimeout(() => sec.classList.add('is-on'), 50)
}

// forças a cada passo de física (unidades: px por passo de 1/60 s)
const G = 0.55
Matter.Events.on(engine, 'beforeUpdate', () => {
  const vh = window.innerHeight
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]
    const b = p.body
    if (p.mode === 'fall-in') {
      Body.setVelocity(b, { x: b.velocity.x * 0.99, y: b.velocity.y + G * p.dir })
      // ao chegar na altura de repouso, a mola assume (é o "pouso")
      if ((p.dir > 0 && b.position.y >= p.ty - 6) || (p.dir < 0 && b.position.y <= p.ty + 6)) p.mode = 'spring'
    } else if (p.mode === 'spring') {
      const k = 0.06
      const c = 0.16
      Body.setVelocity(b, {
        x: b.velocity.x + (p.tx - b.position.x) * k - b.velocity.x * c,
        y: b.velocity.y + (p.ty - b.position.y) * k - b.velocity.y * c,
      })
      Body.setAngularVelocity(b, b.angularVelocity + -b.angle * 0.05 - b.angularVelocity * 0.14)
    } else {
      Body.setVelocity(b, { x: b.velocity.x, y: b.velocity.y + G * p.dir })
      const y = b.position.y
      if (y > vh * 2.2 || y < -vh * 1.2) {
        Composite.remove(engine.world, b)
        p.el.style.transform = ''
        const sec = p.el.closest<HTMLElement>('.gv-s')!
        pieces.splice(i, 1)
        if (!pieces.some((q) => q.el.closest('.gv-s') === sec) && sec !== sections[current]) sec.classList.remove('is-live')
      }
    }
  }
})

// cursor como corpo físico
let mx = -500
let my = -500
window.addEventListener('pointermove', (e) => {
  mx = e.clientX
  my = e.clientY
})

let current = -1
function go(i: number) {
  if (i === current) return
  const dir = i > current ? 1 : -1
  if (current >= 0) release(sections[current], dir)
  current = i
  document.body.style.backgroundColor = sections[i].dataset.bg || '#efe9df'
  enter(sections[i], dir)
}

let last = performance.now()
function frame(t: number) {
  lenis?.raf(t)
  const vh = window.innerHeight
  const i = Math.max(0, Math.min(sections.length - 1, Math.floor((window.scrollY + vh * 0.5) / vh)))
  go(i)

  const dt = Math.min(32, t - last)
  last = t
  const cx = cursor.position.x
  const cy = cursor.position.y
  Body.setPosition(cursor, { x: mx, y: my })
  Body.setVelocity(cursor, { x: (mx - cx) * 0.6, y: (my - cy) * 0.6 })
  Engine.update(engine, dt)

  for (const p of pieces) {
    const b = p.body
    p.el.style.transform = `translate(${b.position.x - p.tx}px, ${b.position.y - p.ty}px) rotate(${b.angle}rad)`
  }
  requestAnimationFrame(frame)
}

document.querySelectorAll<HTMLAnchorElement>('[data-go]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault()
    const y = Number(a.dataset.go) * window.innerHeight
    lenis ? lenis.scrollTo(y, { duration: 2 }) : window.scrollTo(0, y)
  }),
)

async function boot() {
  await document.fonts.ready
  await Promise.all(Array.from(document.images).map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))))
  document.body.classList.remove('is-loading')
  if (reduce) {
    // sem física: as composições aparecem e somem
    const show = () => {
      const i = Math.floor((window.scrollY + window.innerHeight / 2) / window.innerHeight)
      sections.forEach((s, j) => s.classList.toggle('is-live', j === i))
      sections.forEach((s, j) => s.classList.toggle('is-on', j === i))
    }
    window.addEventListener('scroll', show, { passive: true })
    show()
    return
  }
  requestAnimationFrame(frame)
  setTimeout(() => lenis?.start(), 1800)
}

boot()
