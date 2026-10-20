import './r.css'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Press, Print, type Inks } from './gl/Riso'

// Proposta R — "Prensa": o grupo impresso em risografia. Cada casa tem o seu par de tintas;
// o scroll gira a retícula, troca a casa com a passada do rolo e, rápido demais, tira as chapas de registro.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.08, wheelMultiplier: 0.85 })
lenis?.stop()

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!
const $$ = (s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<HTMLElement>(s))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

const HOUSES: { name: string; meta: string; img: string; inks: Inks }[] = [
  { name: 'Íz', meta: 'Contemporânea · Setor Marista · desde 2015', img: '/img/iz_unnamed.webp', inks: ['#3255a4', '#ff665e'] },
  { name: '1929', meta: 'Trattoria · o ano da avó, Dona Colombina', img: '/img/t1929.webp', inks: ['#00838a', '#ffb511'] },
  { name: 'Grá', meta: 'Bistrô francês · 192 metros acima de Goiânia', img: '/img/gra2.webp', inks: ['#5b2a4d', '#ff48b0'] },
  { name: 'Alata', meta: 'Sorvete artesanal', img: '/img/nip_pistache.webp', inks: ['#00a95c', '#ffe800'] },
  { name: 'Fulles', meta: 'Fulles Kitchen · cozinha na lenha', img: '/img/nip_polpetone.webp', inks: ['#6b3a2a', '#ff6c2f'] },
  { name: 'Íz Hotel', meta: 'Restaurant with rooms · três suítes', img: '/img/iz_9.webp', inks: ['#2f4858', '#f6a0b8'] },
  { name: 'nip', meta: 'Not in Napoli · Rua 1130', img: '/img/nip_fachada.webp', inks: ['#0078bf', '#ff48b0'] },
]

// chapas de um elemento .reg: deslocamento entre as duas tintas
function setReg(el: HTMLElement, x: number, y: number) {
  el.style.setProperty('--rx', `${x.toFixed(2)}px`)
  el.style.setProperty('--ry', `${y.toFixed(2)}px`)
}
function setRegText(el: HTMLElement, t: string) {
  el.querySelectorAll('span').forEach((s) => (s.textContent = t))
}

// máscara de tinta irregular para o carimbo
function inkMask() {
  const c = document.createElement('canvas')
  c.width = c.height = 180
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 180, 180)
  const d = g.getImageData(0, 0, 180, 180)
  for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = Math.random() < 0.16 ? 0 : 255
  g.putImageData(d, 0, 0)
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 26; i++) {
    g.globalAlpha = 0.25 + Math.random() * 0.55
    g.beginPath()
    g.ellipse(Math.random() * 180, Math.random() * 180, 4 + Math.random() * 22, 2 + Math.random() * 6, Math.random() * 3, 0, Math.PI * 2)
    g.fill()
  }
  return `url(${c.toDataURL()})`
}

async function boot() {
  await document.fonts.ready
  const press = new Press($<HTMLCanvasElement>('.r-gl'), '#f2ede3')
  const houseTex = await Promise.all(HOUSES.map((h) => press.texture(h.img)))
  const prints = new Map<HTMLElement, Print>()
  await Promise.all(
    $$('[data-print]').map(async (el) => {
      const inks = el.dataset.inks!.split(',') as Inks
      prints.set(el, await press.add(el, el.dataset.print!, inks))
    }),
  )
  const hero = prints.get($('.r-hero__print'))!
  const grupo = prints.get($('[data-turn]'))!
  const casas = prints.get($('[data-houses]'))!
  hero.reg = 1
  hero.grow = 0

  // ponteiro: ponto de tinta; sobre uma impressão vira lupa
  const dot = $('.r-loupe')
  let mx = -999
  let my = -999
  let dx = mx
  let dy = my
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })
  document.addEventListener('pointerleave', () => (mx = my = -999))
  $$('a, button').forEach((a) => {
    a.addEventListener('pointerenter', () => dot.classList.add('is-big'))
    a.addEventListener('pointerleave', () => dot.classList.remove('is-big'))
  })

  // casas: lista lateral e estado
  const list = $('.r-casas__list')
  HOUSES.forEach((h) => {
    const li = document.createElement('li')
    li.innerHTML = `<i style="--a:${h.inks[0]};--b:${h.inks[1]}"></i>${h.name}`
    list.appendChild(li)
  })
  const lis = $$('li', list)
  const cWrap = $('.r-casas')
  const cName = $('.r-casas__name')
  const cMeta = $('.r-casas__meta')
  const cNum = $('.r-casas__n')
  let active = -1
  let pairIdx = -1
  const cu = casas.mesh.material.uniforms
  const nameKick = { v: 0 }
  function showHouse(i: number) {
    active = i
    const h = HOUSES[i]
    setRegText(cName, h.name)
    cName.style.setProperty('--c1', h.inks[0])
    cName.style.setProperty('--c2', h.inks[1])
    cMeta.textContent = h.meta
    cNum.textContent = String(i + 1).padStart(2, '0')
    lis.forEach((l, k) => l.classList.toggle('is-on', k === i))
    gsap.fromTo(nameKick, { v: 1 }, { v: 0, duration: 1.1, ease: 'expo.out' })
  }
  showHouse(0)

  // princípios: cada linha preenche a largura quando está no centro
  const wides = $$('[data-wide]')
  const fitWide = () =>
    wides.forEach((l) => {
      l.style.fontSize = '100px'
      l.style.setProperty('--wd', '125')
      l.style.width = 'max-content'
      const w = l.getBoundingClientRect().width
      l.style.width = ''
      const avail = l.parentElement!.clientWidth - parseFloat(getComputedStyle(l.parentElement!).paddingLeft) * 2
      l.style.fontSize = `${Math.floor((100 * avail) / w)}px`
    })
  fitWide()
  const wideInks = ['#3255a4', '#ff48b0', '#00838a', '#ff665e']

  // números: as chapas tremem até registrar
  const nums = $$('[data-count]')
  const counted = new Set<HTMLElement>()
  function count(el: HTMLElement) {
    counted.add(el)
    const to = Number(el.dataset.count)
    const o = { v: to > 1000 ? to - 60 : 0, j: 1 }
    gsap.to(o, {
      v: to,
      j: 0,
      duration: 2.2,
      ease: 'expo.out',
      onUpdate: () => {
        setRegText(el, String(Math.round(o.v)))
        setReg(el, (Math.random() - 0.5) * 22 * o.j + 9 * o.j, (Math.random() - 0.5) * 10 * o.j)
      },
    })
  }

  // marca-texto
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target as HTMLElement
        if (el.dataset.count) count(el)
        else el.classList.add('is-in')
        io.unobserve(el)
      }),
    { rootMargin: '0px 0px -28% 0px' },
  )
  $$('.hl').forEach((el) => io.observe(el))
  nums.forEach((el) => io.observe(el))

  // carimbo
  const zone = $('.r-stampzone')
  const stamp = $('.r-stamp')
  const masks = Array.from({ length: 4 }, inkMask)
  const stampInks = ['#ff48b0', '#3255a4', '#00838a', '#ff665e', '#5b2a4d']
  let stamps = 0
  const regKick = { v: 0 }
  stamp.addEventListener('click', () => {
    const zr = zone.getBoundingClientRect()
    const imp = document.createElement('span')
    imp.className = 'r-imp'
    imp.textContent = stamp.textContent
    imp.style.setProperty('--mask', masks[stamps % masks.length])
    imp.style.color = stampInks[stamps % stampInks.length]
    zone.appendChild(imp)
    const ir = imp.getBoundingClientRect()
    const x = (Math.random() - 0.5) * Math.max(0, zr.width - ir.width) * 0.9 + (zr.width - ir.width) / 2
    const y = (Math.random() - 0.5) * Math.max(0, zr.height - ir.height) * 0.9 + (zr.height - ir.height) / 2
    gsap.set(imp, { left: x, top: y, rotate: (Math.random() - 0.5) * 22, opacity: 0 })
    gsap
      .timeline()
      .to(stamp, { scale: 0.9, y: 8, duration: 0.12, ease: 'power3.in' })
      .set(imp, { opacity: 0.92 })
      .fromTo(imp, { scale: 1.06 }, { scale: 1, duration: 0.25, ease: 'power2.out' }, '<')
      .to(stamp, { scale: 1, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.5)' }, '<')
    gsap.fromTo(regKick, { v: 0.5 }, { v: 0, duration: 0.9, ease: 'expo.out' })
    stamps++
    const all = $$('.r-imp', zone)
    if (all.length > 9) gsap.to(all[0], { opacity: 0, duration: 0.6, onComplete: () => all[0].remove() })
  })

  // colofão: as tintas de cada casa
  const inksRow = $('.r-f__inks')
  HOUSES.forEach((h) => {
    const d = document.createElement('div')
    d.className = 'r-ink'
    d.innerHTML = `<div class="r-ink__sw"><i style="background:${h.inks[0]}"></i><i style="background:${h.inks[1]}"></i></div><span>${h.name}</span><small>${h.inks[0].toUpperCase()} + ${h.inks[1].toUpperCase()}</small>`
    inksRow.appendChild(d)
  })
  const footMark = $('.r-f__mark')
  const heroMark = $('.r-hero__mark')

  // velocidade: rápido demais, as chapas saem de registro
  let vel = 0
  const intro = { mark: 1, grow: 0 }

  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const H = window.innerHeight
    vel += ((lenis ? Math.abs(lenis.velocity) : 0) - vel) * 0.12
    const shake = Math.min(1, vel / 60) + regKick.v

    // cursor e lupa
    dx += (mx - dx) * 0.35
    dy += (my - dy) * 0.35
    dot.style.transform = `translate(${dx}px, ${dy}px)`
    let over: Print | null = null
    prints.forEach((p, el) => {
      const r = el.getBoundingClientRect()
      if (mx > r.left && mx < r.right && my > r.top && my < r.bottom) over = p
    })
    dot.classList.toggle('is-off', !!over)
    prints.forEach((p) => (p.loupe += ((p === over ? 78 : 0) - p.loupe) * 0.16))

    // abertura
    hero.reg = intro.mark * 0.9 + shake * 0.35
    hero.grow = intro.grow
    const hr = heroMark.getBoundingClientRect()
    const heroOut = clamp(-hr.top / H)
    setReg(heroMark, (intro.mark * 34 + shake * 10 + heroOut * 30) * 1, (-intro.mark * 18 - heroOut * 12) * 1)

    // o grupo: a retícula gira
    const gs = $('.r-grupo').getBoundingClientRect()
    const gp = clamp((H - gs.top) / (gs.height + H))
    grupo.angle = gp * 1.6
    grupo.reg = shake * 0.35 + Math.sin(gp * Math.PI) * 0.06

    // casas: a passada do rolo
    const cr = cWrap.getBoundingClientRect()
    const cp = clamp(-cr.top / (cr.height - H)) * (HOUSES.length - 1)
    const idx = Math.min(HOUSES.length - 2, Math.floor(cp))
    const f = cp - idx
    if (idx !== pairIdx) {
      pairIdx = idx
      cu.tA.value = houseTex[idx]
      cu.uAspA.value = houseTex[idx].image.width / houseTex[idx].image.height
      cu.uInkA1.value.set(HOUSES[idx].inks[0])
      cu.uInkB1.value.set(HOUSES[idx].inks[1])
      casas.setNext(houseTex[idx + 1], HOUSES[idx + 1].inks)
    }
    casas.sweep = smooth(0.3, 0.85, f)
    casas.reg = shake * 0.35 + Math.sin(casas.sweep * Math.PI) * 0.25
    const want = casas.sweep > 0.5 ? idx + 1 : idx
    if (want !== active) showHouse(want)
    setReg(cName, nameKick.v * 16 + shake * 8, -nameKick.v * 7)

    // princípios
    wides.forEach((l, i) => {
      const r = l.getBoundingClientRect()
      const k = 1 - clamp(Math.abs(r.top + r.height / 2 - H / 2) / (H * 0.5))
      const e = k * k * (3 - 2 * k)
      l.style.setProperty('--wd', (62 + 63 * e).toFixed(1))
      l.style.setProperty('--c', e > 0.82 ? wideInks[i] : '')
    })

    // números parados ainda tremem com a velocidade
    nums.forEach((el) => {
      if (counted.has(el) && !gsap.isTweening(el)) setReg(el, shake * 9, shake * -4)
    })
    const fr = footMark.getBoundingClientRect()
    if (fr.top < H) {
      const k = 1 - clamp((H - fr.top) / (H * 0.8))
      setReg(footMark, k * 40 + shake * 8, -k * 20)
    }
    press.render(mx, my)
  })
  gsap.ticker.lagSmoothing(0)

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
    press.resize()
    fitWide()
  })

  // entrada: a primeira chapa sai, a segunda chega desencontrada e entra em registro
  const plates = $$('span', heroMark)
  const words = $$('.r-w')
  gsap.set(plates[1], { opacity: 0 })
  gsap.set(words, { opacity: 0, '--wd': 62 })
  document.body.classList.remove('is-loading')
  gsap
    .timeline({ delay: 0.2 })
    .fromTo(plates[0], { clipPath: 'inset(-40% -10% 100% -10%)' }, { clipPath: 'inset(-40% -10% -10% -10%)', duration: 1.1, ease: 'power3.inOut' })
    .to(plates[1], { opacity: 1, duration: 0.05 }, '-=0.15')
    .fromTo(plates[1], { clipPath: 'inset(-40% -10% 100% -10%)' }, { clipPath: 'inset(-40% -10% -10% -10%)', duration: 1.0, ease: 'power3.inOut' }, '<')
    .to(intro, { grow: 1, duration: 2.4, ease: 'power2.out' }, 0.5)
    .to(intro, { mark: 0, duration: 2.6, ease: 'expo.inOut' }, 1.3)
    .to(words, { opacity: 1, '--wd': 100, duration: 1.4, stagger: 0.08, ease: 'expo.out' }, 2.4)
    .add(() => lenis?.start(), 2.6)
}

boot()
