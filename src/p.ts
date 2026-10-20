import './p.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Stage } from './gl/Stage'
import { MediaStage, type Media } from './gl/Media'
import { tickPointer } from './ui/pointer'

// Proposta P: uma animação diferente por seção, todas na mesma família
// (mesma curva, mesma paleta, mesma tipografia, mesmo cursor e grão).

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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const $$ = (s: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>(s))
const pinned = (el: Element) => {
  const r = el.getBoundingClientRect()
  return clamp(-r.top / Math.max(1, r.height - window.innerHeight))
}

// pseudo-aleatório estável por índice
const rnd = (i: number, s = 1) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453
  return x - Math.floor(x)
}

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
function scramble(el: HTMLElement, dur = 0.9) {
  const text = el.dataset.txt || ''
  const o = { p: 0 }
  gsap.to(o, {
    p: 1,
    duration: dur + text.length * 0.012,
    ease: 'power2.out',
    onUpdate: () => {
      const n = o.p * text.length
      let s = ''
      for (let i = 0; i < text.length; i++) s += text[i] === ' ' || i < n - 2 ? text[i] : i < n + 3 ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : ' '
      el.textContent = s
    },
    onComplete: () => void (el.textContent = text),
  })
}

// letras em spans, palavras sem quebra; devolve as letras
function splitChars(el: HTMLElement) {
  const chars: HTMLElement[] = []
  const walk = (node: Node, parent: HTMLElement, italic: boolean) =>
    Array.from(node.childNodes).forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE)
        (c.textContent || '').split(/(\s+)/).forEach((p) => {
          if (!p) return
          if (/^\s+$/.test(p)) return void parent.appendChild(document.createTextNode(' '))
          const wd = document.createElement('span')
          wd.className = 'wd'
          for (const ch of p) {
            const s = document.createElement('span')
            s.className = 'ch'
            s.textContent = ch
            if (italic) s.dataset.it = '1'
            wd.appendChild(s)
            chars.push(s)
          }
          parent.appendChild(wd)
        })
      else {
        const cl = (c as HTMLElement).cloneNode(false) as HTMLElement
        parent.appendChild(cl)
        walk(c, cl, italic || (c as HTMLElement).tagName === 'EM')
      }
    })
  const src = el.cloneNode(true)
  el.textContent = ''
  walk(src, el, false)
  return chars
}

function splitLines(el: HTMLElement) {
  const tmp = document.createElement('div')
  tmp.innerHTML = el.innerHTML
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
      // preserva itálico e palavras com rastro de fotos
      let node: Node = document.createTextNode(w.textContent || '')
      let p = w.parentElement
      while (p && p !== el) {
        const wrap = p.cloneNode(false) as HTMLElement
        wrap.appendChild(node)
        node = wrap
        p = p.parentElement
      }
      inner.appendChild(node)
      if (j < ws.length - 1) inner.appendChild(document.createTextNode(' '))
    })
    ln.appendChild(inner)
    el.appendChild(ln)
  })
}

async function boot() {
  await document.fonts.ready
  // quebra em linhas antes de ligar eventos (a quebra recria os elementos)
  $$('[data-lines]').forEach(splitLines)

  // ---------- 1. abertura (motor da proposta A) ----------
  const stage = new Stage($<HTMLCanvasElement>('.p-gl-hero'))
  await stage.load(() => {})
  const media = new MediaStage($<HTMLCanvasElement>('.p-gl-media'))
  const slides: Media[] = []
  for (const f of $$('[data-slide]')) {
    const m = await media.add(f)
    m.reveal = 1
    slides.push(m)
  }

  // ---------- cursor ----------
  const cursor = $('.p-cursor')
  const clabel = $('.p-cursor__label')
  let mx = window.innerWidth / 2
  let my = window.innerHeight / 2
  let cx = mx
  let cy = my
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })
  document.addEventListener('pointerover', (e) => {
    const t = e.target as HTMLElement
    const lab = t.closest<HTMLElement>('[data-cursor]')
    cursor.classList.toggle('is-label', !!lab)
    cursor.classList.toggle('is-link', !lab && !!t.closest('a, button'))
    if (lab) clabel.textContent = lab.dataset.cursor || ''
  })

  // ---------- botões magnéticos ----------
  $$('[data-magnet]').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect()
      gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.6, ease: 'power3.out' })
    })
    b.addEventListener('pointerleave', () => gsap.to(b, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.45)' }))
  })

  // ---------- 2. manifesto: peso por letra ----------
  const mani = $('.p-mani')
  const maniChars = splitChars($('[data-weight]'))

  // ---------- 3. o grupo: rastro de fotos ----------
  const trail = $('.p-trail')
  let lastDrop = { x: 0, y: 0 }
  let trailIdx = 0
  $$('.p-hot').forEach((el) => {
    const imgs = (el.dataset.trail || '').split(',')
    el.dataset.cursor = ''
    el.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - lastDrop.x, e.clientY - lastDrop.y) < 70) return
      lastDrop = { x: e.clientX, y: e.clientY }
      const img = document.createElement('img')
      img.src = imgs[trailIdx++ % imgs.length]
      img.style.left = e.clientX + 'px'
      img.style.top = e.clientY + 'px'
      trail.appendChild(img)
      const rot = (Math.random() - 0.5) * 14
      gsap
        .timeline({ onComplete: () => img.remove() })
        .fromTo(img, { scale: 0.4, rotate: rot * 2, clipPath: 'inset(50% 50% 50% 50%)' }, { scale: 1, rotate: rot, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'expo.out' })
        .to(img, { scale: 0.85, opacity: 0, y: 40, duration: 0.9, ease: 'power2.in' }, 0.6)
    })
  })

  // ---------- 4. casas: arrastar + rolar ----------
  const casas = $('.p-casas')
  const track = $('.p-casas__track')
  const names = $$('.p-name')
  const meta = $('.p-casas__meta')
  names.forEach((n) => {
    const t = n.textContent || ''
    n.textContent = ''
    ;[...t].forEach((c, i) => {
      const s = document.createElement('span')
      s.className = 'lt'
      s.textContent = c
      s.style.setProperty('--i', String(i))
      n.appendChild(s)
    })
  })
  let drag = 0
  let dragT = 0
  let dragging = false
  let lastX = 0
  track.addEventListener('pointerdown', (e) => {
    dragging = true
    lastX = e.clientX
  })
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return
    dragT += e.clientX - lastX
    lastX = e.clientX
  })
  window.addEventListener('pointerup', () => {
    dragging = false
  })
  let activeName = -1

  // ---------- 5. cartas ----------
  const cards = $$('.p-card')
  cards.forEach((c, i) => c.style.setProperty('--k', String(i)))

  // ---------- 6. bastidores: letras espalhadas que se montam ----------
  const bts = $('.p-bts')
  const btsChars = splitChars($('[data-assemble]'))
  const btsImg = $('.p-bts__img')
  let odoDone = false
  const odos = $$('[data-odo]')
  odos.forEach((el) => {
    el.innerHTML = ''
    ;(el.dataset.odo || '0').split('').forEach((d, i) => {
      const col = document.createElement('span')
      col.className = 'col'
      col.dataset.d = d
      col.style.setProperty('--i', String(i))
      col.innerHTML = Array.from({ length: 10 }, (_, k) => `<span>${k}</span>`).join('')
      el.appendChild(col)
    })
  })

  // ---------- 7. imprensa: faixa ligada à velocidade ----------
  const marq = $('.p-marq__in')
  marq.innerHTML += marq.innerHTML
  let mPos = 0
  let mSkew = 0

  // ---------- 9. rodapé ----------
  const markLetters = $$('.p-f__mark span')

  // ---------- reveals ----------
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))), {
    rootMargin: '0px 0px -12% 0px',
  })
  $$('[data-lines], [data-r]').forEach((el) => io.observe(el))

  // ---------- quadro a quadro ----------
  const hero = $('.p-hero')
  const heroT = $('.p-hero__t')
  const intro = { done: false }
  gsap.ticker.add((time, dtMs) => {
    const dt = Math.min(dtMs / 1000, 0.05)
    lenis?.raf(time * 1000)
    tickPointer(dt)
    const W = window.innerWidth
    const H = window.innerHeight
    const vel = lenis ? lenis.velocity : 0
    cx += (mx - cx) * 0.2
    cy += (my - cy) * 0.2
    cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`

    // 1. abertura
    const hr = hero.getBoundingClientRect()
    const hp = clamp(-hr.top / (hr.height - H))
    if (intro.done) stage.hero.scroll = hp
    stage.hero.visible = hr.bottom > 0
    heroT.style.opacity = String(1 - smooth(0, 0.12, hp))
    if (stage.hero.visible) stage.render()

    // 2. manifesto: a frente de leitura engorda as letras
    const mp = pinned(mani)
    const front = mp * (maniChars.length + 20) - 10
    maniChars.forEach((c, i) => {
      const k = clamp((front - i) / 10)
      const it = c.dataset.it === '1'
      c.style.setProperty('--w', String(Math.round(lerp(200, it ? 420 : 520, k))))
      c.style.setProperty('--s', String(Math.round(lerp(0, 100, k))))
      c.style.setProperty('--a', lerp(0.14, 1, k).toFixed(3))
    })

    // 4. casas
    drag += (dragT - drag) * 0.12
    const cp = pinned(casas)
    const maxX = track.scrollWidth - W
    const x = clamp(cp * maxX - drag, 0, maxX)
    track.style.transform = `translate3d(${-x}px, 0, 0)`
    let best = 0
    let bestD = Infinity
    slides.forEach((m, i) => {
      const r = m.el.getBoundingClientRect()
      const dx = (r.left + r.width / 2 - W / 2) / W
      m.tilt = -dx * 1.1
      m.dim = lerp(1, 0.4, clamp(Math.abs(dx) * 2.2))
      m.zoom = 1 + clamp(1 - Math.abs(dx) * 3) * 0.06
      if (Math.abs(dx) < bestD) {
        bestD = Math.abs(dx)
        best = i
      }
    })
    const inCasas = casas.getBoundingClientRect().top < H * 0.5 && casas.getBoundingClientRect().bottom > H * 0.5
    if (inCasas && best !== activeName) {
      names.forEach((n, i) => {
        n.classList.toggle('is-on', i === best)
        n.classList.toggle('is-out', i !== best && n.classList.contains('is-on'))
      })
      setTimeout(() => names.forEach((n, i) => i !== best && n.classList.remove('is-out')), 500)
      meta.textContent = names[best].dataset.meta || ''
      activeName = best
    }

    // 5. cartas: a de baixo encolhe e escurece quando a próxima a cobre
    cards.forEach((c, i) => {
      const next = cards[i + 1]
      const ir = c.getBoundingClientRect()
      c.style.setProperty('--iz', String(lerp(1.15, 1, smooth(H, H * 0.1, ir.top))))
      if (!next) return
      const nr = next.getBoundingClientRect()
      const k = smooth(H, H * 0.12, nr.top)
      c.style.setProperty('--sc', String(1 - k * 0.06))
      c.style.setProperty('--br', String(1 - k * 0.35))
    })

    // 6. bastidores: letras chegam de posições espalhadas
    const bp = pinned(bts)
    const ass = smooth(0.05, 0.7, bp)
    btsChars.forEach((c, i) => {
      const k = clamp(ass * 1.6 - rnd(i) * 0.6)
      const e = 1 - Math.pow(1 - k, 3)
      const dx = (rnd(i, 2) - 0.5) * W * 0.9
      const dy = (rnd(i, 3) - 0.5) * H * 0.9
      c.style.transform = `translate(${dx * (1 - e)}px, ${dy * (1 - e)}px) rotate(${(rnd(i, 4) - 0.5) * 140 * (1 - e)}deg) scale(${lerp(0.4, 1, e)})`
      c.style.opacity = String(lerp(0, 1, e))
    })
    btsImg.style.setProperty('--bz', String(lerp(1.25, 1.02, bp)))
    if (!odoDone && bp > 0.6) {
      odoDone = true
      odos.forEach((o) => o.querySelectorAll<HTMLElement>('.col').forEach((c) => (c.style.transform = `translateY(${-Number(c.dataset.d) * 0.9}em)`)))
    }

    // 7. imprensa
    mPos -= (1.2 + Math.abs(vel) * 0.35) * Math.sign(vel || 1) * (dt * 60)
    const half = marq.scrollWidth / 2
    if (mPos < -half) mPos += half
    if (mPos > 0) mPos -= half
    mSkew += (clamp(vel * 0.4, -12, 12) - mSkew) * 0.1
    marq.style.transform = `translate3d(${mPos}px, 0, 0) skewX(${-mSkew}deg)`

    // 9. rodapé: peso pela distância do cursor
    markLetters.forEach((l) => {
      const r = l.getBoundingClientRect()
      const d = Math.hypot(mx - (r.left + r.width / 2), my - (r.top + r.height / 2))
      const k = clamp(1 - d / (W * 0.45))
      const cur = parseFloat(l.style.getPropertyValue('--w') || '200')
      l.style.setProperty('--w', String(Math.round(lerp(cur, lerp(200, 900, k), 0.12))))
      l.style.setProperty('--s', String(Math.round(k * 100)))
    })

    // cor da moldura por seção
    const dark = (el: Element) => {
      const b = el.getBoundingClientRect()
      return b.top < 60 && b.bottom > 60
    }
    document.body.classList.toggle('on-dark', dark(casas) || dark(bts) || cards.some((c, i) => i >= 2 && dark(c)))

    media.render(vel)
  })
  gsap.ticker.lagSmoothing(0)

  // ---------- navegação ----------
  $$('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const t = $((a as HTMLAnchorElement).getAttribute('href')!)
      lenis ? lenis.scrollTo(t, { duration: 2.2 }) : t.scrollIntoView()
    }),
  )
  $$('[data-top]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      lenis ? lenis.scrollTo(0, { duration: 2.6 }) : window.scrollTo(0, 0)
    }),
  )
  window.addEventListener('resize', () => {
    stage.resize()
    media.resize()
  })

  // ---------- entrada (mesma da A) ----------
  $$('[data-scr]').forEach((el) => {
    el.dataset.txt = el.textContent || ''
    el.textContent = ' '
  })
  document.body.classList.remove('is-loading')
  gsap
    .timeline({ delay: 0.3 })
    .to(stage.hero, { dot: 15, duration: 0.35, ease: 'power2.in' })
    .to(stage.hero, { reveal: 1, duration: 1.25, ease: 'expo.inOut' })
    .to(stage.hero, { fill: 1, duration: 1.1, ease: 'power2.inOut' }, '-=0.35')
    .add(() => $$('[data-scr]').forEach((el, i) => setTimeout(() => scramble(el), i * 160)), '-=0.6')
    .add(() => {
      intro.done = true
      lenis?.start()
    })
}

boot()
