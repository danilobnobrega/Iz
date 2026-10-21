import '@fontsource-variable/jetbrains-mono'
import '@fontsource/instrument-serif'
import './w.css'
import Lenis from 'lenis'
import { Pics, HeroInk } from './gl/Pics'

// Proposta W — as palavras do grupo são a figura central. As fotos entram como palavras dentro
// das frases, do tamanho de uma letra. Entre uma cena e outra, a última foto de uma frase abre na
// tela inteira por um instante e pousa, já trocada, dentro da frase seguinte. Tudo depende só da
// posição da rolagem: parar no meio nunca quebra nada, e voltar desfaz exatamente.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
scrollTo(0, 0)

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const fit = (v: number, a: number, b: number) => clamp((v - a) / (b - a))
// a curva única do site: arranque firme, chegada longa
const ease = (t: number) => {
  // cubic-bezier(.35,0,0,1) aproximada por solução numérica
  let x = t
  for (let i = 0; i < 6; i++) {
    const cx = 3 * 0.35, bx = 3 * (0 - 0.35) - cx, ax = 1 - cx - bx
    const fx = ((ax * x + bx) * x + cx) * x - t
    const dx = (3 * ax * x + 2 * bx) * x + cx
    if (Math.abs(fx) < 1e-5 || Math.abs(dx) < 1e-6) break
    x -= fx / dx
  }
  x = clamp(x)
  const cy = 0, by = 3 * (1 - 0) - cy, ay = 1 - cy - by
  return ((ay * x + by) * x + cy) * x
}
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!
const $$ = (s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<HTMLElement>(s))

const L = 2 // telas por cena
const S = 1.4 // espalhamento da cascata de palavras

type Token = { el: HTMLElement; inner: HTMLElement | null; ord: number; step: number; img?: HTMLElement; fx: number; fy: number; lx: number; ly: number }
type Scene = {
  el: HTMLElement
  i: number
  tokens: Token[]
  imgs: { el: HTMLElement; name: string; ord: number; step: number; grow: number; hover: boolean }[]
  inImg: HTMLElement | null
  outImg: HTMLElement | null
  rolls: { el: HTMLElement; spans: HTMLElement[]; widths: number[] }[]
  nums: { el: HTMLElement; to: number }[]
  houses: HTMLElement[]
  steps: number
}

// quebra o texto em palavras mascaradas; fotos, números e a palavra que gira viram uma peça só
function split(root: HTMLElement, out: Token[], step: number) {
  const walk = (node: Node, parent: Node) => {
    Array.from(node.childNodes).forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        ;(c.textContent || '').split(/(\s+)/).forEach((w) => {
          if (!w) return
          if (/^\s+$/.test(w)) return void parent.appendChild(document.createTextNode(' '))
          const s = document.createElement('span')
          s.className = 'w-wd'
          const i = document.createElement('span')
          i.textContent = w
          s.appendChild(i)
          parent.appendChild(s)
          out.push({ el: s, inner: i, ord: 0, step, fx: 0, fy: 0, lx: NaN, ly: NaN })
        })
        return
      }
      const el = c as HTMLElement
      if (el.classList.contains('w-img')) {
        const cl = el.cloneNode(false) as HTMLElement
        parent.appendChild(cl)
        out.push({ el: cl, inner: null, ord: 0, step, img: cl, fx: 0, fy: 0, lx: NaN, ly: NaN })
        return
      }
      if (el.classList.contains('w-roll') || el.classList.contains('w-num')) {
        const wrap = document.createElement('span')
        wrap.className = 'w-wd'
        const cl = el.cloneNode(true) as HTMLElement
        wrap.appendChild(cl)
        parent.appendChild(wrap)
        out.push({ el: wrap, inner: cl, ord: 0, step, fx: 0, fy: 0, lx: NaN, ly: NaN })
        return
      }
      const cl = el.cloneNode(false)
      parent.appendChild(cl)
      walk(el, cl)
    })
  }
  const tmp = root.cloneNode(true)
  root.innerHTML = ''
  walk(tmp, root)
}

async function boot() {
  await document.fonts.ready
  const pics = new Pics($<HTMLCanvasElement>('.w-gl'))

  // prepara as cenas
  const scenes: Scene[] = $$('[data-scene]').map((el, i) => {
    const tokens: Token[] = []
    const blocks = $$('.w-k, .w-hero__iz, .w-s, .w-by, .w-house, .w-cta, .w-chan li, .w-sign', el).filter(
      (b) => !b.closest('.w-house') || b.classList.contains('w-house'),
    )
    for (const b of blocks) {
      const step = Number(b.closest<HTMLElement>('[data-step]')?.dataset.step ?? -1)
      split(b, tokens, step)
    }
    // ordem da cascata: por passo e por posição
    const byStep = new Map<number, Token[]>()
    tokens.forEach((t) => {
      const k = t.step
      if (!byStep.has(k)) byStep.set(k, [])
      byStep.get(k)!.push(t)
    })
    byStep.forEach((arr) => arr.forEach((t, j) => (t.ord = arr.length > 1 ? j / (arr.length - 1) : 0)))
    const imgs = tokens
      .filter((t) => t.img)
      .map((t) => ({ el: t.img!, name: t.img!.dataset.img!, ord: t.ord, step: t.step, grow: 1, hover: false }))
    imgs.forEach((m) => m.el.style.setProperty('--r', m.el.dataset.r || '1.4'))
    const rolls = $$('.w-roll', el).map((r) => {
      const names = (r.dataset.roll || '').split('|')
      r.innerHTML = ''
      const spans = names.map((n) => {
        const s = document.createElement('span')
        s.textContent = n
        r.appendChild(s)
        return s
      })
      return { el: r, spans, widths: [] as number[] }
    })
    const nums = $$('.w-num', el).map((n) => ({ el: n, to: Number(n.dataset.num) }))
    const houses = $$('.w-house', el)
    const steps = Math.max(0, ...tokens.map((t) => t.step)) + 1
    return {
      el,
      i,
      tokens,
      imgs,
      inImg: $('[data-in]', el) as HTMLElement | null,
      outImg: $('[data-out]', el) as HTMLElement | null,
      rolls,
      nums,
      houses,
      steps,
    }
  })
  // casas: a foto cresce dentro da linha ao passar o mouse
  scenes.forEach((sc) =>
    sc.houses.forEach((h) => {
      const img = sc.imgs.find((m) => h.contains(m.el))
      h.addEventListener('pointerenter', () => {
        sc.houses.forEach((o) => o.classList.remove('is-hot'))
        if (img) img.hover = true
        hovered = h
      })
      h.addEventListener('pointerleave', () => {
        if (img) img.hover = false
        hovered = null
      })
      h.addEventListener('click', (e) => e.preventDefault())
    }),
  )
  let hovered: HTMLElement | null = null
  scenes.forEach((sc) =>
    sc.imgs.forEach((m) => {
      if (m.el.closest('.w-house')) return
      m.el.addEventListener('pointerenter', () => (m.hover = true))
      m.el.addEventListener('pointerleave', () => (m.hover = false))
    }),
  )
  // ponteiro
  const ptr = { x: -9999, y: -9999, speed: 0, lx: 0, ly: 0 }
  addEventListener('pointermove', (e) => {
    const d = Math.hypot(e.clientX - ptr.lx, e.clientY - ptr.ly)
    ptr.speed = ptr.speed * 0.6 + d * 60 * 0.4
    ptr.x = ptr.lx = e.clientX
    ptr.y = ptr.ly = e.clientY
  })
  const heroEl = $('.w-hero__iz')
  const ink = new HeroInk(pics)

  const measureRolls = () =>
    scenes.forEach((sc) => sc.rolls.forEach((r) => (r.widths = r.spans.map((s) => s.getBoundingClientRect().width))))

  // altura da página: uma tela de folga no fim
  const spacer = document.createElement('div')
  document.body.appendChild(spacer)
  const layout = () => {
    spacer.style.height = `${((scenes.length - 1) * L + 1.9) * innerHeight}px`
    pics.resize()
    measureRolls()
    ink.setText(heroEl)
  }
  layout()
  addEventListener('resize', layout)

  // carregamento
  const names = new Set(scenes.flatMap((s) => s.imgs.map((m) => m.name)))
  const n = $('.w-load__n')
  let done = 0
  await Promise.all(
    [...names].map((nm) =>
      pics.load(nm).then(() => {
        done++
        n.textContent = String(Math.round((done / names.size) * 100)).padStart(3, '0')
      }),
    ),
  )
  document.body.classList.remove('is-loading')

  const lenis = reduce ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 0.8 })
  $$('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const y = (Number(a.dataset.go) * L + 0.55) * innerHeight
      lenis ? lenis.scrollTo(y, { duration: 2.2 }) : scrollTo(0, y)
    }),
  )

  const t0 = performance.now()
  let last = t0
  let velS = 0
  const rect = (el: HTMLElement) => el.getBoundingClientRect()

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lenis?.raf(now)
    const vh = innerHeight
    const u = scrollY / vh
    velS += ((lenis?.velocity ?? 0) / 40 - velS) * 0.1
    pics.vel = velS
    pics.time = (now - t0) / 1000
    const intro = reduce ? 1 : fit((now - t0) / 1000, 0.25, 2.4)

    pics.begin()
    ink.mesh.visible = false
    scenes.forEach((sc, k) => {
      const t = u - k * L
      const first = k === 0
      const lastScene = k === scenes.length - 1
      const enterBase = first ? intro : fit(t, -0.1, 0.55)
      const exit = lastScene ? 0 : fit(t, 1.2, 1.6)
      const on = enterBase > 0 && exit < 1
      sc.el.classList.toggle('is-on', on)
      if (!on) return

      // passos: cenas com várias linhas entram uma a uma enquanto a cena está parada
      const stepAt = (s: number) => {
        if (s < 0 || sc.steps <= 1) return enterBase
        if (s === 0) return enterBase
        return fit(t, 0.05 + (s - 1) * 0.32, 0.4 + (s - 1) * 0.32)
      }
      const kf = 1 - Math.pow(1 - 0.13, dt * 60)
      for (const tk of sc.tokens) {
        const a = stepAt(tk.step)
        const la = ease(clamp(a * (1 + S) - tk.ord * S))
        const lb = ease(clamp(exit * (1 + S) - tk.ord * S))
        if (tk.inner) tk.inner.style.transform = `translate3d(0, ${((1 - la) * 112 - lb * 112).toFixed(2)}%, 0)`
        // quando uma foto cresce, as palavras deslizam para o lugar novo em vez de pular
        const ox = tk.el.offsetLeft
        const oy = tk.el.offsetTop
        if (!Number.isNaN(tk.lx) && (ox !== tk.lx || oy !== tk.ly)) {
          tk.fx -= ox - tk.lx
          tk.fy -= oy - tk.ly
        }
        tk.lx = ox
        tk.ly = oy
        tk.fx -= tk.fx * kf
        tk.fy -= tk.fy * kf
        if (Math.abs(tk.fx) < 0.05) tk.fx = 0
        if (Math.abs(tk.fy) < 0.05) tk.fy = 0
        tk.el.style.transform = tk.fx || tk.fy ? `translate3d(${tk.fx.toFixed(2)}px, ${tk.fy.toFixed(2)}px, 0)` : ''
      }
      // fotos de frase: crescem ao passar o mouse, e a frase abre espaço
      if (!sc.houses.length)
        for (const m of sc.imgs) {
          const want = m.hover ? 1.75 : 1
          m.grow += (want - m.grow) * (1 - Math.pow(1 - 0.1, dt * 60))
          m.el.style.setProperty('--grow', m.grow.toFixed(4))
        }
      // o Íz do topo
      if (first) {
        const hr = heroEl.getBoundingClientRect()
        const ha = ease(clamp(enterBase * 1.4))
        const hb = ease(clamp(exit * 1.6))
        ink.update(hr.left, hr.top, hr.width, hr.height, ptr.x, ptr.y, ptr.speed, 'iz_unnamed', ha, hb)
        ptr.speed *= 0.9
      }

      // palavra que gira: D.O.M. → Maní → Can Roca → Mugaritz, presa à rolagem
      for (const r of sc.rolls) {
        const v = fit(t, 0.35, 1.15) * (r.spans.length - 1)
        r.spans.forEach((s, i) => {
          const off = i - v
          s.style.transform = `translate3d(0, ${(off * 110).toFixed(2)}%, 0)`
          s.style.opacity = String(clamp(1 - Math.abs(off) * 1.6))
        })
        const i0 = Math.floor(v)
        const f = v - i0
        const w0 = r.widths[i0] ?? 0
        const w1 = r.widths[Math.min(r.spans.length - 1, i0 + 1)] ?? w0
        r.el.style.width = `${w0 + (w1 - w0) * ease(f)}px`
      }
      // números contam junto com a rolagem
      for (const nm of sc.nums) nm.el.textContent = Math.round(nm.to * ease(fit(t, -0.1, 0.8))).toLocaleString('pt-BR')

      // casa em destaque: a do mouse; sem mouse, a rolagem passa por elas
      if (sc.houses.length) {
        const hotI = hovered ? -1 : Math.min(sc.houses.length - 1, Math.floor(fit(t, 0.3, 1.15) * sc.houses.length))
        sc.houses.forEach((h, i) => h.classList.toggle('is-hot', i === hotI))
        for (const m of sc.imgs) {
          const house = m.el.closest('.w-house')!
          const want = m.hover || house.classList.contains('is-hot') ? 1 : 0
          m.grow += (want - m.grow) * (1 - Math.pow(1 - 0.14, dt * 60))
          m.el.style.setProperty('--grow', Math.max(0.001, m.grow).toFixed(4))
          m.el.style.marginLeft = `${(0.12 * m.grow).toFixed(3)}em`
        }
      }

      // fotos dentro das frases
      for (const m of sc.imgs) {
        if (sc.houses.length && m.grow < 0.01) continue
        const carriedOut = m.el === sc.outImg && !lastScene && t > 1.18
        const carriedIn = m.el === sc.inImg && !first && t < 0.62
        if (carriedOut || carriedIn) continue
        const a = stepAt(m.step)
        const rv = ease(clamp(a * (1 + S) - m.ord * S))
        const hd = ease(clamp(exit * (1 + S) - m.ord * S))
        const b = rect(m.el)
        const hovering = m.hover ? 1.06 : 1
        pics.draw(b.left, b.top, b.width, b.height, { a: m.name, reveal: rv, hide: hd, radius: b.height * 0.12, zoom: hovering })
      }
    })

    // a foto que atravessa: sai da última foto de uma cena, ocupa a tela, pousa na primeira da seguinte
    for (let k = 0; k < scenes.length - 1; k++) {
      const t = u - k * L
      if (t < 1.18 || t > 2.62) continue
      const A = scenes[k].outImg
      const B = scenes[k + 1].inImg
      if (!A || !B) continue
      const ra = rect(A)
      const rb = rect(B)
      const e1 = ease(fit(t, 1.18, 1.72))
      const mx = fit(t, 1.62, 2.0)
      const e2 = ease(fit(t, 1.95, 2.62))
      const full = { x: 0, y: 0, w: innerWidth, h: vh }
      const r1 = {
        x: ra.left + (full.x - ra.left) * e1,
        y: ra.top + (full.y - ra.top) * e1,
        w: ra.width + (full.w - ra.width) * e1,
        h: ra.height + (full.h - ra.height) * e1,
      }
      const r2 = {
        x: r1.x + (rb.left - r1.x) * e2,
        y: r1.y + (rb.top - r1.y) * e2,
        w: r1.w + (rb.width - r1.w) * e2,
        h: r1.h + (rb.height - r1.h) * e2,
      }
      const radA = ra.height * 0.12
      const radB = rb.height * 0.12
      const rad = e2 > 0 ? radB * e2 : radA * (1 - e1)
      pics.draw(r2.x, r2.y, r2.w, r2.h, {
        a: A.dataset.img!,
        b: B.dataset.img!,
        mix: mx,
        radius: rad,
        zoom: 1 + Math.sin(Math.PI * fit(t, 1.18, 2.62)) * 0.06,
        order: 5,
      })
    }
    pics.end()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  ;(window as any).__w = { lenis, scenes, ink, ptr }
}
boot()
