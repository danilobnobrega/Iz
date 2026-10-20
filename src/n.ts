import './n.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Nave } from './gl/Nave'

// Proposta N. Entrada com cinco eventos encadeados e sobrepostos; o scroll atravessa
// a marca e conduz a câmera por um corredor iluminado pelo cursor; o menu curva e
// desfoca o mundo; som sintetizado opcional.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.075, wheelMultiplier: 0.8 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!

const HOUSES = [
  { name: 'Íz', meta: 'Contemporânea · Setor Marista · desde 2015', img: '/img/iz_unnamed.webp' },
  { name: '1929 Trattoria', meta: 'Italiana · o ano da avó, Dona Colombina', img: '/img/t1929.webp' },
  { name: 'Grá', meta: 'Bistrô francês · 192 metros acima de Goiânia', img: '/img/gra2.webp' },
  { name: 'Alata', meta: 'Sorvete artesanal', img: '/img/nip_pistache.webp' },
  { name: 'Fulles Kitchen', meta: 'Cozinha na lenha', img: '/img/nip_polpetone.webp' },
  { name: 'Íz Hotel', meta: 'Restaurant with rooms · três suítes', img: '/img/iz_9.webp' },
  { name: 'nip', meta: 'Not in Napoli · Rua 1130', img: '/img/nip_fachada.webp' },
]
const EXTRAS = ['/img/gra1.webp', '/img/nip_pizza.webp', '/img/caviar.webp', '/img/iz_rest.webp', '/img/ian_chef.webp', '/img/socios.webp', '/img/trattoria.webp', '/img/ian_neo.webp', '/img/iz_rest.webp', '/img/gra1.webp']

// ---------- texto embaralhado (Podium) ----------
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function scramble(el: HTMLElement, text = el.dataset.txt || el.textContent || '', dur = 0.7) {
  el.dataset.txt = text
  const o = { p: 0 }
  gsap.killTweensOf(el)
  return gsap.to(o, {
    p: 1,
    duration: dur + text.length * 0.012,
    ease: 'power2.out',
    onUpdate: () => {
      const n = o.p * text.length
      let s = ''
      for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (c === ' ' || i < n - 2) s += c
        else if (i < n + 3) s += GLYPHS[(Math.random() * GLYPHS.length) | 0]
        else s += ' '
      }
      el.textContent = s
    },
    onComplete: () => void (el.textContent = text),
  })
}

// ---------- som sintetizado (opcional, desligado de início) ----------
let ac: AudioContext | null = null
let soundOn = false
const blip = (freq: number, dur = 0.05, gain = 0.03, type: OscillatorType = 'sine') => {
  if (!soundOn || !ac) return
  const o = ac.createOscillator()
  const g = ac.createGain()
  o.type = type
  o.frequency.value = freq
  g.gain.setValueAtTime(0, ac.currentTime)
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur)
  o.connect(g).connect(ac.destination)
  o.start()
  o.stop(ac.currentTime + dur + 0.02)
}
const whoosh = (up: boolean) => {
  if (!soundOn || !ac) return
  const len = ac.sampleRate * 0.6
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ac.createBufferSource()
  src.buffer = buf
  const f = ac.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = 1.2
  f.frequency.setValueAtTime(up ? 300 : 1800, ac.currentTime)
  f.frequency.exponentialRampToValueAtTime(up ? 1800 : 300, ac.currentTime + 0.5)
  const g = ac.createGain()
  g.gain.value = 0.05
  src.connect(f).connect(g).connect(ac.destination)
  src.start()
}
const chime = (i: number) => {
  // uma nota por casa, numa escala pentatônica
  const scale = [392, 440, 523.25, 587.33, 659.25, 783.99, 880]
  blip(scale[i % scale.length], 0.9, 0.025, 'triangle')
  blip(scale[i % scale.length] * 2, 0.5, 0.008, 'sine')
}

async function boot() {
  const canvas = $<HTMLCanvasElement>('.n-gl')
  const nave = new Nave(canvas, '#ebe4d8', '#1a1612')
  const loadN = $('.n-load__n')
  const shown = { v: 0 }

  await document.fonts.load("900 100px 'Fraunces Variable'")
  await document.fonts.ready

  // o ponto aparece enquanto carrega
  let mx = window.innerWidth / 2
  let my = window.innerHeight / 2
  let rx = mx
  let ry = my
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })
  const tick = () => {
    rx += (mx - rx) * 0.12
    ry += (my - ry) * 0.12
    nave.render(rx, ry, lenis ? lenis.velocity : 0)
  }

  await nave.build(
    HOUSES.map((h) => h.img),
    EXTRAS,
    (p) => gsap.to(shown, { v: p * 100, duration: 0.4, onUpdate: () => void (loadN.textContent = String(Math.round(shown.v)).padStart(3, '0')) }),
  )
  nave.mark.dot = 0
  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    tick()
  })
  gsap.ticker.lagSmoothing(0)
  gsap.to(nave.mark, { dot: 5, duration: 0.5, ease: 'back.out(2)' })
  await new Promise((r) => setTimeout(r, 900))
  $('.n-load').classList.add('is-done')

  // ---------- entrada: cinco eventos encadeados, cada um começando antes do anterior acabar ----------
  const scrEls = Array.from(document.querySelectorAll<HTMLElement>('[data-scr]'))
  scrEls.forEach((el) => {
    el.dataset.txt = el.textContent || ''
    el.textContent = ' '
  })
  document.body.classList.remove('is-loading')
  const tl = gsap.timeline()
  tl.to(nave.mark, { dot: 14, duration: 0.3, ease: 'power2.in' })
    .to(nave.mark, { reveal: 1, duration: 0.85, ease: 'power2.inOut' }) // ponto → marca
    .to(nave.mark, { fill: 1, duration: 1.1, ease: 'power2.inOut' }, '-=0.45') // mundo sobe dentro da marca
    .to(nave.mark, { pulse: 1, duration: 0.26, ease: 'power2.out', yoyo: true, repeat: 1 }, '-=0.35') // pulso
    .to(nave.post, { blur: 0, ca: 0.8, duration: 2.6, ease: 'power2.inOut' }, 0) // a lente entra em foco
    .to(nave.post, { vignette: 0.12, duration: 2.6, ease: 'power2.inOut' }, 0)
    .add(() => $$('.n-h [data-scr]').forEach((el, i) => setTimeout(() => scramble(el), i * 90)), '-=0.9') // menu embaralha
    .add(() => $$('.n-hero__ui [data-scr]').forEach((el, i) => setTimeout(() => scramble(el, undefined, 0.9), i * 160)), '-=0.5') // manchete
  setTimeout(() => lenis?.start(), 2600)

  // ---------- scroll ----------
  const hero = $('.n-hero')
  const heroUI = $('.n-hero__ui')
  const houses = $('.n-houses')
  const hName = $('.n-houses__name')
  const hMeta = $('.n-houses__meta')
  const hNum = $('.n-houses__n')
  let active = -1
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.n-rows li'))

  gsap.ticker.add(() => {
    const r = hero.getBoundingClientRect()
    const vh = window.innerHeight
    const hp = clamp(-r.top / (r.height - vh))
    if (tl.progress() >= 1) {
      // atravessa a marca no primeiro trecho
      const through = smooth(0, 0.11, hp)
      nave.mark.scale = 1 + Math.pow(through, 3) * 70
      heroUI.style.opacity = String(1 - smooth(0, 0.035, hp))
      // depois a câmera percorre o corredor
      nave.travel = smooth(0.04, 1, hp)
      nave.threadDraw = 0.06 + nave.travel * 0.98
    }
    document.body.classList.toggle('on-dark', hp > 0.06 && r.bottom > 60)

    // casa ativa pela posição da câmera
    const camZ = 4 - nave.travel * nave.length
    let idx = -1
    HOUSES.forEach((_, i) => {
      const pz = i === 0 ? -2.2 : -6 - i * 8.4
      if (camZ < pz + 6.5 && camZ > pz - 1.5) idx = i
    })
    houses.classList.toggle('is-on', idx >= 0 && hp > 0.08 && hp < 0.995)
    if (idx !== active) {
      active = idx
      if (idx >= 0) {
        hNum.textContent = String(idx + 1).padStart(2, '0')
        scramble(hName, HOUSES[idx].name, 0.6)
        scramble(hMeta, HOUSES[idx].meta, 0.5)
        chime(idx)
      }
    }

    // princípios: a linha mais próxima do centro acende; o fio de cima se desenha ao entrar
    let best = -1
    let bestD = Infinity
    rows.forEach((li, i) => {
      const b = li.getBoundingClientRect()
      const d = Math.abs(b.top + b.height / 2 - vh * 0.5)
      if (d < bestD && b.top < vh && b.bottom > 0) {
        bestD = d
        best = i
      }
      li.style.setProperty('--line', String(smooth(vh, vh * 0.45, b.top)))
    })
    rows.forEach((li, i) => li.classList.toggle('is-on', i === best))
  })

  // ---------- reveal das seções ----------
  document.querySelectorAll<HTMLElement>('[data-lines]').forEach(splitLines)
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target as HTMLElement
        el.classList.add('is-in')
        if (el.matches('[data-odo]')) el.querySelectorAll<HTMLElement>('.col').forEach((c) => (c.style.transform = `translateY(${-Number(c.dataset.d) * 0.9}em)`))
        io.unobserve(el)
      }),
    { rootMargin: '0px 0px -12% 0px' },
  )
  document.querySelectorAll<HTMLElement>('[data-odo]').forEach((el) => {
    const digits = (el.dataset.odo || '0').split('')
    el.innerHTML = ''
    digits.forEach((d, i) => {
      const col = document.createElement('span')
      col.className = 'col'
      col.dataset.d = d
      col.style.setProperty('--i', String(i))
      col.innerHTML = Array.from({ length: 10 }, (_, k) => `<span>${k}</span>`).join('')
      el.appendChild(col)
    })
  })
  document.querySelectorAll('[data-lines], [data-r], [data-odo]').forEach((el) => io.observe(el))

  // ---------- menu: o mundo curva e desfoca por trás ----------
  const menuBtn = $<HTMLButtonElement>('.n-menu-btn')
  document.querySelectorAll<HTMLElement>('.n-menu a').forEach((a, i) => a.style.setProperty('--i', String(i)))
  const setMenu = (open: boolean) => {
    document.body.classList.toggle('menu-open', open)
    menuBtn.setAttribute('aria-expanded', String(open))
    gsap.to(nave.post, { barrel: open ? -0.22 : 0, blur: open ? 10 : 0, duration: open ? 0.55 : 0.65, ease: open ? 'sine.inOut' : 'power2.inOut' })
    whoosh(open)
    if (open) lenis?.stop()
    else lenis?.start()
  }
  menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')))
  window.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false))

  // ---------- som ----------
  const sbtn = $<HTMLButtonElement>('.n-sound')
  sbtn.addEventListener('click', () => {
    if (!ac) ac = new AudioContext()
    soundOn = !soundOn
    sbtn.setAttribute('aria-pressed', String(soundOn))
    blip(soundOn ? 880 : 440, 0.12, 0.04)
  })
  document.querySelectorAll<HTMLElement>('a, button').forEach((el) => el.addEventListener('pointerenter', () => blip(1760, 0.035, 0.012)))
  // texto embaralha de novo ao passar o mouse
  document.querySelectorAll<HTMLElement>('.n-h [data-scr], .n-btn [data-scr]').forEach((el) => el.closest('a, button')!.addEventListener('pointerenter', () => scramble(el, undefined, 0.35)))

  // ---------- navegação ----------
  document.querySelectorAll<HTMLAnchorElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const href = a.getAttribute('href')!
      let y = $(href).getBoundingClientRect().top + window.scrollY
      // "casas" fica dentro do corredor: leva até a primeira casa
      if (href === '#casas') y = hero.offsetTop + (hero.offsetHeight - window.innerHeight) * 0.14
      const go = () => (lenis ? lenis.scrollTo(y, { duration: 2.2 }) : window.scrollTo(0, y))
      if (document.body.classList.contains('menu-open')) {
        setMenu(false)
        setTimeout(go, 300)
      } else go()
    }),
  )
  document.querySelectorAll<HTMLAnchorElement>('[data-top]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      lenis ? lenis.scrollTo(0, { duration: 2.6 }) : window.scrollTo(0, 0)
    }),
  )
  window.addEventListener('resize', () => nave.resize())
}

const $$ = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s))

function splitLines(el: HTMLElement) {
  // quebra em linhas reais, preservando itálico
  const html = el.innerHTML
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  el.innerHTML = ''
  const words: HTMLElement[] = []
  const walk = (node: Node, parent: HTMLElement) =>
    node.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE)
        (c.textContent || '').split(/(\s+)/).forEach((p) => {
          if (!p) return
          if (/^\s+$/.test(p)) return void parent.appendChild(document.createTextNode(' '))
          const w = document.createElement('span')
          w.textContent = p
          parent.appendChild(w)
          words.push(w)
        })
      else {
        const cl = (c as HTMLElement).cloneNode(false) as HTMLElement
        parent.appendChild(cl)
        walk(c, cl)
      }
    })
  walk(tmp, el)
  const lines: HTMLElement[][] = []
  let last = -1
  words.forEach((w) => {
    const t = Math.round(w.getBoundingClientRect().top)
    if (last < 0 || Math.abs(t - last) > 4) lines.push([])
    last = t
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
      if (w.parentElement && w.parentElement.tagName === 'EM') {
        const em = document.createElement('em')
        em.appendChild(node)
        node = em
      }
      inner.appendChild(node)
      if (j < ws.length - 1) inner.appendChild(document.createTextNode(' '))
    })
    ln.appendChild(inner)
    el.appendChild(ln)
  })
}

boot()
