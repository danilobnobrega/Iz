import './s.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Poeira, type Spec } from './gl/Poeira'

// Proposta S — "Poeira": uma só matéria conta o grupo inteiro. A marca, os sócios, as sete casas
// (em relevo), os princípios escritos e, no fim, a marca de novo. O cursor afasta; segurar faz redemoinho.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.075, wheelMultiplier: 0.8 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const $$ = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s))

const HOUSES = [
  { name: 'Íz', meta: 'Contemporânea · Setor Marista · desde 2015', img: '/img/iz_unnamed.webp' },
  { name: '1929 Trattoria', meta: 'Italiana · o ano da avó, Dona Colombina', img: '/img/t1929.webp' },
  { name: 'Grá', meta: 'Bistrô francês · 192 metros acima de Goiânia', img: '/img/gra2.webp' },
  { name: 'Alata', meta: 'Sorvete artesanal', img: '/img/nip_pistache.webp' },
  { name: 'Fulles', meta: 'Fulles Kitchen · cozinha na lenha', img: '/img/nip_polpetone.webp' },
  { name: 'Íz Hotel', meta: 'Restaurant with rooms · três suítes', img: '/img/iz_9.webp' },
  { name: 'nip', meta: 'Not in Napoli · Rua 1130', img: '/img/nip_fachada.webp' },
]
const GUIA: { lines: string[]; color: string }[] = [
  { lines: ['Cuidado,', 'não pompa.'], color: '#efe6d6' },
  { lines: ['A base é linguagem,', 'não regra.'], color: '#f0b183' },
  { lines: ['Local, sem', 'ser óbvio.'], color: '#efe6d6' },
  { lines: ['Nada de', 'acomodação.'], color: '#e0703a' },
]

// som: um acorde quente e um sopro que acompanha o movimento da matéria
class Sound {
  ctx?: AudioContext
  master?: GainNode
  air?: GainNode
  band?: BiquadFilterNode
  on = false
  private init() {
    const ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700
    lp.connect(master)
    ;[110, 164.81, 220, 277.18, 329.63].forEach((f, i) => {
      const o = ctx.createOscillator()
      o.type = i % 2 ? 'triangle' : 'sine'
      o.frequency.value = f
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.05 + i * 0.03
      const lg = ctx.createGain()
      lg.gain.value = 2.5
      lfo.connect(lg).connect(o.detune)
      const g = ctx.createGain()
      g.gain.value = 0.022
      o.connect(g).connect(lp)
      o.start()
      lfo.start()
    })
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = 0.9
    band.frequency.value = 400
    const air = ctx.createGain()
    air.gain.value = 0
    src.connect(band).connect(air).connect(master)
    src.start()
    Object.assign(this, { ctx, master, air, band })
  }
  toggle() {
    if (!this.ctx) this.init()
    this.on = !this.on
    this.ctx!.resume()
    this.master!.gain.setTargetAtTime(this.on ? 0.55 : 0, this.ctx!.currentTime, 0.4)
    return this.on
  }
  motion(k: number) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime
    this.air!.gain.setTargetAtTime(Math.min(0.32, k * 0.22), t, 0.08)
    this.band!.frequency.setTargetAtTime(260 + k * 2200, t, 0.1)
  }
}

function splitChars(el: HTMLElement) {
  const out: HTMLElement[] = []
  const walk = (node: Node, parent: Node) =>
    Array.from(node.childNodes).forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        ;(c.textContent || '').split(/(\s+)/).forEach((w) => {
          if (!w) return
          if (/^\s+$/.test(w)) return void parent.appendChild(document.createTextNode(' '))
          const word = document.createElement('span')
          word.style.display = 'inline-block'
          word.style.whiteSpace = 'nowrap'
          for (const ch of w) {
            const s = document.createElement('span')
            s.className = 'ch'
            s.textContent = ch
            word.appendChild(s)
            out.push(s)
          }
          parent.appendChild(word)
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

function splitLines(el: HTMLElement) {
  const chars = splitChars(el)
  const words = Array.from(new Set(chars.map((c) => c.parentElement!)))
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
      const txt = document.createTextNode(w.textContent || '')
      const italic = w.closest('em') || w.parentElement?.tagName === 'EM'
      if (italic) {
        const em = document.createElement('em')
        em.appendChild(txt)
        inner.appendChild(em)
      } else inner.appendChild(txt)
      if (j < ws.length - 1) inner.appendChild(document.createTextNode(' '))
    })
    ln.appendChild(inner)
    el.appendChild(ln)
  })
}

async function boot() {
  await document.fonts.ready
  await Promise.all([document.fonts.load('600 200px "Fraunces Variable"'), document.fonts.load('italic 300 200px "Fraunces Variable"')])
  const small = window.innerWidth < 820 || matchMedia('(hover: none)').matches
  const poeira = new Poeira($<HTMLCanvasElement>('.s-gl'), small)
  const vw = poeira.viewW
  const mob = window.innerWidth < 820

  const glyph = (w: number): Spec => ({ kind: 'text', lines: ['Íz'], font: '600 %px "Fraunces Variable"', w, x: 0, y: mob ? 60 : 10, color: '#efe6d6' })
  const pw = mob ? vw * 0.92 : Math.min(820, vw * 0.5)
  const px = mob ? 0 : vw * 0.17
  const py = mob ? 150 : 0
  const specs: Spec[] = [
    glyph(mob ? vw * 0.8 : Math.min(540, vw * 0.4)),
    { kind: 'photo', src: '/img/socios.webp', w: mob ? pw : Math.min(700, vw * 0.44), h: (mob ? pw : Math.min(700, vw * 0.44)) * 0.82, x: px + (mob ? 0 : 40), y: py, depth: 150 },
    ...HOUSES.map((h): Spec => ({ kind: 'photo', src: h.img, w: pw, h: pw * 0.66, x: px, y: py, depth: 190 })),
    ...GUIA.map((g, i): Spec => ({
      kind: 'text',
      lines: g.lines,
      font: '300 %px "Fraunces Variable"',
      italic: i % 2 === 1,
      w: mob ? vw * 0.92 : Math.min(1180, vw * 0.78),
      x: 0,
      y: 20,
      color: g.color,
    })),
    { kind: 'galaxy', r: mob ? vw * 0.6 : Math.min(640, vw * 0.46) },
    glyph(mob ? vw * 0.9 : Math.min(600, vw * 0.45)),
  ]
  const loadN = $('.s-load__n')
  const shown = { v: 0 }
  await poeira.build(specs, (p) =>
    gsap.to(shown, { v: p * 100, duration: 0.5, onUpdate: () => void (loadN.textContent = String(Math.round(shown.v)).padStart(3, '0')) }),
  )

  // âncoras: cada forma é inteira quando o centro da sua seção cruza o centro da tela
  const shapeEls = $$('[data-shape]')
  let anchors: number[] = []
  const measure = () => {
    const H = window.innerHeight
    const max = document.documentElement.scrollHeight - H
    anchors = shapeEls.map((el) => {
      const r = el.getBoundingClientRect()
      return clamp(r.top + window.scrollY + r.height / 2 - H / 2, 0, max)
    })
  }
  measure()
  const stageAt = (y: number) => {
    for (let k = 0; k < anchors.length - 1; k++) if (y < anchors[k + 1]) return k + clamp((y - anchors[k]) / Math.max(1, anchors[k + 1] - anchors[k]))
    return anchors.length - 1
  }

  // texto
  const titleChars = splitChars($('.s-title'))
  $$('[data-lines]').forEach(splitLines)
  const lit = $('[data-lit]')
  const litWords = (lit.textContent || '').split(/\s+/).filter(Boolean)
  lit.innerHTML = litWords.map((w) => `<span class="w">${w}</span>`).join(' ')
  const litEls = $$('.s-lit .w')

  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))), {
    rootMargin: '0px 0px -18% 0px',
  })
  $$('[data-lines], [data-fade]').forEach((el) => io.observe(el))

  // casa atual: as letras giram como placas
  const house = $('.s-house')
  const hName = $('.s-house__name')
  const hMeta = $('.s-house__meta')
  const hIdx = $('.s-house__i')
  const hBar = $('.s-house__bar')
  let active = -1
  let dir = 1
  function showHouse(i: number) {
    const old = Array.from(hName.querySelectorAll<HTMLElement>('.ch'))
    dir = i > active ? 1 : -1
    active = i
    hIdx.textContent = String(i + 1).padStart(2, '0')
    hBar.style.setProperty('--p', String((i + 1) / HOUSES.length))
    hMeta.textContent = HOUSES[i].meta
    gsap.fromTo(hMeta, { opacity: 0, y: 8 * dir }, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', delay: 0.15 })
    const swap = () => {
      hName.textContent = HOUSES[i].name
      const chars = splitChars(hName)
      gsap.fromTo(
        chars,
        { rotateX: -90 * dir, yPercent: 40 * dir, opacity: 0 },
        { rotateX: 0, yPercent: 0, opacity: 1, duration: 1.1, ease: 'expo.out', stagger: 0.035 },
      )
    }
    if (old.length) gsap.to(old, { rotateX: 90 * dir, yPercent: -40 * dir, opacity: 0, duration: 0.35, ease: 'power2.in', stagger: 0.015, onComplete: swap })
    else swap()
  }
  const guiaK = document.createElement('p')
  guiaK.className = 's-guia-k'
  document.body.appendChild(guiaK)

  // cursor
  const cur = $('.s-cur')
  let mx = window.innerWidth / 2
  let my = window.innerHeight / 2
  let cx = mx
  let cy = my
  let inside = false
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
    inside = true
  })
  document.addEventListener('pointerleave', () => (inside = false))
  const holdT = { v: 0 }
  window.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('a, button')) return
    cur.classList.add('is-hold')
    gsap.to(holdT, { v: 1, duration: 0.6, ease: 'power2.out' })
  })
  window.addEventListener('pointerup', () => {
    cur.classList.remove('is-hold')
    gsap.to(holdT, { v: 0, duration: 0.9, ease: 'power2.out' })
  })
  $$('a, button').forEach((a) => {
    a.addEventListener('pointerenter', () => cur.classList.add('is-link'))
    a.addEventListener('pointerleave', () => cur.classList.remove('is-link'))
  })

  // botão: magnético, preenche a partir de onde o cursor entrou
  const btn = $('.s-btn')
  btn.addEventListener('pointerenter', (e) => {
    const r = btn.getBoundingClientRect()
    btn.style.setProperty('--x', `${e.clientX - r.left}px`)
    btn.style.setProperty('--y', `${e.clientY - r.top}px`)
  })
  btn.addEventListener('pointermove', (e) => {
    const r = btn.getBoundingClientRect()
    gsap.to(btn, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.6, ease: 'power3.out' })
  })
  btn.addEventListener('pointerleave', (e) => {
    const r = btn.getBoundingClientRect()
    btn.style.setProperty('--x', `${e.clientX - r.left}px`)
    btn.style.setProperty('--y', `${e.clientY - r.top}px`)
    gsap.to(btn, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.4)' })
  })

  const sound = new Sound()
  const sBtn = $('.s-sound')
  sBtn.addEventListener('click', () => {
    const on = sound.toggle()
    sBtn.classList.toggle('is-on', on)
    sBtn.setAttribute('aria-pressed', String(on))
    sBtn.setAttribute('aria-label', on ? 'Desligar som' : 'Ligar som')
  })

  let vel = 0
  const intro = { k: 0 }
  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const W = window.innerWidth
    const H = window.innerHeight
    vel += ((lenis ? Math.abs(lenis.velocity) : 0) - vel) * 0.1
    const y = lenis ? lenis.scroll : window.scrollY
    const s = stageAt(y)
    const st = poeira.setStage(s)

    cx += (mx - cx) * 0.22
    cy += (my - cy) * 0.22
    cur.style.transform = `translate(${cx}px, ${cy}px)`
    poeira.orbit.x += ((mx / W - 0.5) * 2 - poeira.orbit.x) * 0.04
    poeira.orbit.y += ((my / H - 0.5) * 2 - poeira.orbit.y) * 0.04
    if (inside) poeira.pointer((mx / W) * 2 - 1, -(my / H) * 2 + 1)
    else poeira.mouse.set(9999, 9999, 0)
    poeira.hold = holdT.v
    poeira.push = 2.6 * intro.k
    const swing = Math.sin(Math.PI * st.f) * (0.18 + st.relief * 0.2) * (st.idx % 2 ? -1 : 1)
    poeira.render(time, swing, 0.004 + Math.min(1, vel / 50) * 0.045 + poeira.burst * 0.012)
    sound.motion(poeira.burst + holdT.v * 0.8 + Math.min(1, vel / 60) * 0.4)

    // casas: estágios 2..8
    const r = Math.round(s)
    const h = s > 1.55 && s < 8.45 ? clamp(r - 2, 0, HOUSES.length - 1) : -1
    house.classList.toggle('is-on', h >= 0)
    if (h >= 0 && h !== active) showHouse(h)
    if (h < 0 && active !== -1) {
      active = -1
      gsap.to(hName.querySelectorAll('.ch'), { opacity: 0, yPercent: -30, duration: 0.4, stagger: 0.01, onComplete: () => void (active === -1 && (hName.textContent = '')) })
    }
    // princípios: estágios 9..12
    const g = s > 8.55 && s < 12.45 ? clamp(r - 9, 0, 3) : -1
    guiaK.classList.toggle('is-on', g >= 0)
    if (g >= 0) guiaK.textContent = `O que nos guia · ${String(g + 1).padStart(2, '0')} / 04`

    // palavras acendem
    litEls.forEach((w) => {
      const b = w.getBoundingClientRect()
      w.style.setProperty('--k', clamp((H * 0.78 - b.top) / (H * 0.4)).toFixed(3))
    })
  })
  gsap.ticker.lagSmoothing(0)

  $$('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = $((a as HTMLAnchorElement).getAttribute('href')!)
      lenis ? lenis.scrollTo(t, { duration: 3.2, easing: (x) => 1 - Math.pow(1 - x, 4) }) : t.scrollIntoView()
    }),
  )
  $$('[data-top]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      lenis ? lenis.scrollTo(0, { duration: 4 }) : window.scrollTo(0, 0)
    }),
  )
  window.addEventListener('resize', () => {
    poeira.resize()
    measure()
  })

  // entrada encadeada: a nuvem desaba na marca, a câmera chega, o brilho baixa, o título nasce
  document.body.classList.remove('is-loading')
  $('.s-load').classList.add('is-done')
  poeira.dolly = 1600
  poeira.noise = 0.9
  poeira.spring = 0
  poeira.bloom.strength = 2.4
  poeira.final.uniforms.uFade.value = 0
  gsap.set(titleChars, { opacity: 0, yPercent: 60, filter: 'blur(12px)' })
  gsap.set(['.s-h', '.s-hint'], { opacity: 0 })
  gsap
    .timeline({ delay: 0.15 })
    .to(poeira.final.uniforms.uFade, { value: 1, duration: 1.6, ease: 'power2.out' }, 0)
    .to(poeira, { spring: 0.022, duration: 3.6, ease: 'power2.inOut' }, 0.2)
    .to(poeira, { noise: 0.06, duration: 3.4, ease: 'power3.inOut' }, 0.4)
    .to(poeira, { dolly: 0, duration: 4.2, ease: 'expo.inOut' }, 0)
    .to(poeira.bloom, { strength: 0.45, duration: 3.8, ease: 'power2.inOut' }, 0.6)
    .to(intro, { k: 1, duration: 1.5 }, 2.8)
    .to(titleChars, { opacity: 1, yPercent: 0, filter: 'blur(0px)', duration: 1.6, stagger: 0.022, ease: 'expo.out' }, 2.6)
    .to(['.s-h', '.s-hint'], { opacity: 1, duration: 1.4, ease: 'power2.out' }, 3.2)
    .add(() => lenis?.start(), 3.0)
}

boot()
