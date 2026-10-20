import './toalha.css'
import Lenis from 'lenis'
import { TableStage } from './gl/Cloth'

// Proposta K: a página abre coberta por uma toalha de linho bordada.
// A toalha é puxada pela ponta ao rolar e revela o salão; no fim, ela volta.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.85 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

const MONO = 'Íz'
const LINE = 'GRUPO DE GASTRONOMIA  ·  GOIÂNIA  ·  DESDE 2015'

async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>('.tl-gl')!
  const stage = new TableStage(canvas)
  await document.fonts.load("640 200px 'Fraunces Variable'")
  await document.fonts.load("500 20px 'Inter Tight Variable'")
  await document.fonts.ready

  // a ponta que o garçom segura: canto inferior direito
  let corner: number[] = []
  const build = () => {
    stage.build(MONO, LINE)
    const cl = stage.cloth
    corner = []
    for (let r = cl.rows - 3; r < cl.rows; r++) for (let c = cl.cols - 3; c < cl.cols; c++) corner.push(r * cl.cols + c)
    // a toalha é estendida: cai de um pouco acima e assenta na mesa
    for (let i = 0; i < cl.cols * cl.rows; i++) {
      const k = i * 3
      const x = cl.rest[k]
      const y = cl.rest[k + 1]
      cl.p[k + 2] = 140 + Math.sin(x * 0.006 + y * 0.004) * 60 + Math.cos(y * 0.01) * 30
      cl.prev[k + 2] = cl.p[k + 2]
    }
  }
  build()

  // estado ligado ao scroll
  const open = document.querySelector<HTMLElement>('.tl-open')!
  const openSticky = open.querySelector<HTMLElement>('.tl-open__sticky')!
  const close = document.querySelector<HTMLElement>('.tl-close')!
  const header = document.querySelector<HTMLElement>('.tl-h')!

  let mx = -9999
  let my = -9999
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })

  let acc = 0
  let last = performance.now()
  let asleep = false
  const DT = 1 / 60

  function frame(now: number) {
    lenis?.raf(now)
    const vh = window.innerHeight
    const W = stage.w
    const H = stage.h
    const cl = stage.cloth

    // quanto a toalha foi puxada (0 = posta, 1 = fora)
    const or = open.getBoundingClientRect()
    const hp = clamp(-or.top / (or.height - vh))
    const cr = close.getBoundingClientRect()
    const cp = clamp((vh - cr.top) / (vh * 1.25))
    const pull = hp < 1 ? smooth(0.04, 0.92, hp) : 1 - smooth(0.0, 0.9, cp)

    openSticky.style.setProperty('--o', String(smooth(0.35, 0.8, pull)))
    openSticky.style.setProperty('--z', String(1.12 - 0.12 * pull))
    header.classList.toggle('on-image', hp > 0.45 && hp < 1 && pull > 0.4)

    const visible = pull < 0.995
    canvas.style.visibility = visible ? 'visible' : 'hidden'
    if (visible) asleep = false

    if (!asleep) {
      // a ponta: sobe, e é levada para fora da tela pela direita
      const t = easeInOut(pull)
      const lift = 280 * smooth(0, 0.18, pull)
      const ox = W * 2.4 * t
      const oy = H * 0.4 * t
      for (const i of corner) {
        cl.pinned[i] = pull > 0.002 ? 1 : 0
        const k = i * 3
        cl.pinTarget[k] = cl.rest[k] + ox
        cl.pinTarget[k + 1] = cl.rest[k + 1] + oy
        cl.pinTarget[k + 2] = lift
      }
      const restPull = pull < 0.02 ? 0.03 * (1 - pull / 0.02) : 0
      const lift2 = mx > -9000 && pull < 0.6 ? { x: mx - W / 2, y: H / 2 - my, r: 190, h: 60 } : null

      acc += Math.min(0.05, (now - last) / 1000)
      let n = 0
      while (acc >= DT && n < 3) {
        cl.step(DT, { lift: lift2, restPull })
        acc -= DT
        n++
      }
      if (n === 3) acc = 0
      cl.sync()
      stage.render()
      if (!visible) asleep = true
    }
    last = now
    requestAnimationFrame(frame)
  }

  // textos e listas
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))), {
    rootMargin: '0px 0px -12% 0px',
  })
  document.querySelectorAll('[data-r]').forEach((el) => io.observe(el))
  document.querySelectorAll<HTMLElement>('.tl-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))

  const peek = document.querySelector<HTMLImageElement>('.tl-peek')!
  let px = 0
  let py = 0
  document.querySelectorAll<HTMLElement>('.tl-list li').forEach((li) => {
    li.addEventListener('pointerenter', () => {
      peek.src = li.dataset.img || ''
      peek.classList.add('is-on')
    })
    li.addEventListener('pointerleave', () => peek.classList.remove('is-on'))
  })
  const follow = () => {
    px += (mx - px) * 0.12
    py += (my - py) * 0.12
    peek.style.transform = `translate(${px + 30}px, ${py - 160}px) rotate(${clamp((mx - px) * 0.05, -6, 6)}deg)`
    requestAnimationFrame(follow)
  }
  follow()

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

  let rw = window.innerWidth
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - rw) < 2 && Math.abs(window.innerHeight - stage.h) < 120) return
    rw = window.innerWidth
    build()
  })

  document.body.classList.remove('is-loading')
  requestAnimationFrame(frame)
  setTimeout(() => lenis?.start(), 1400)
}

boot()
