import './t.css'
import gsap from 'gsap'

// Proposta T — "Serviço": a energia de uma cozinha em pleno serviço. Ritmo, precisão, cortes secos.
// Rolagem nativa (nada flutua), a história anda por batidas e toda transição é um corte de faca.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!
const $$ = (s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<HTMLElement>(s))

const HOUSES = [
  { name: 'Íz', meta: 'Contemporânea · desde 2015', img: '/img/iz_unnamed.webp' },
  { name: '1929', meta: 'Trattoria da Dona Colombina', img: '/img/t1929.webp' },
  { name: 'Grá', meta: 'Bistrô a 192 metros', img: '/img/gra2.webp' },
  { name: 'Alata', meta: 'Sorvete artesanal', img: '/img/nip_pistache.webp' },
  { name: 'Fulles', meta: 'Cozinha na lenha', img: '/img/nip_polpetone.webp' },
  { name: 'Íz Hotel', meta: 'Três suítes', img: '/img/iz_9.webp' },
  { name: 'nip', meta: 'Not in Napoli', img: '/img/nip_fachada.webp' },
]

const BEATS: { w: string; k: string; c: string; img: string; pos: number; fire?: boolean; color?: boolean }[] = [
  { w: 'Karatê', k: 'Goiânia', c: 'Ian Baiocchi e Domingos Ávila se conhecem crianças, na academia de karatê da família.', img: '/img/socios.webp', pos: 0 },
  { w: 'D.O.M.', k: 'São Paulo', c: 'Ian vai para a cozinha de Alex Atala.', img: '/img/ian_chef.webp', pos: 1 },
  { w: 'Maní', k: 'São Paulo', c: 'Depois, a de Helena Rizzo.', img: '/img/caviar.webp', pos: 2 },
  { w: 'Can Roca', k: 'Girona', c: 'El Celler, dos irmãos Roca.', img: '/img/gra1.webp', pos: 3 },
  { w: 'Mugaritz', k: 'Errenteria', c: 'A cozinha de Andoni Luis Aduriz.', img: '/img/ian_neo.webp', pos: 1 },
  { w: 'Goiânia', k: 'De volta', c: 'Ian volta pra casa.', img: '/img/trattoria.webp', pos: 2, fire: true },
  { w: '2015', k: 'Setor Marista', c: 'Abre o Íz.', img: '/img/iz_unnamed.webp', pos: 0, color: true },
  { w: '2016', k: 'Sociedade', c: 'Domingos vira sócio.', img: '/img/socios.webp', pos: 3, color: true },
  { w: '7 casas', k: 'Hoje', c: 'Íz, 1929, Grá, Alata, Fulles, Íz Hotel e nip.', img: '/img/nip_fachada.webp', pos: 1, color: true },
  { w: '445', k: 'A brigada', c: 'pessoas. Padaria, açougue e confeitaria próprios.', img: '/img/iz_rest.webp', pos: 2, fire: true, color: true },
]

// som: um "tac" de faca na tábua a cada corte
class Tac {
  ctx?: AudioContext
  on = false
  private noise?: AudioBuffer
  toggle() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.12, this.ctx.sampleRate)
      const d = b.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6)
      this.noise = b
    }
    this.ctx.resume()
    this.on = !this.on
    return this.on
  }
  play(pitch = 1) {
    if (!this.on || !this.ctx) return
    const c = this.ctx
    const t = c.currentTime
    const src = c.createBufferSource()
    src.buffer = this.noise!
    src.playbackRate.value = 0.8 + pitch * 0.4
    const hp = c.createBiquadFilter()
    hp.type = 'bandpass'
    hp.frequency.value = 1400 + pitch * 900
    hp.Q.value = 1.4
    const g = c.createGain()
    g.gain.value = 0.9
    src.connect(hp).connect(g).connect(c.destination)
    const o = c.createOscillator()
    o.frequency.setValueAtTime(190 * (0.9 + pitch * 0.2), t)
    o.frequency.exponentialRampToValueAtTime(60, t + 0.08)
    const og = c.createGain()
    og.gain.setValueAtTime(0.5, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    o.connect(og).connect(c.destination)
    src.start(t)
    o.start(t)
    o.stop(t + 0.1)
  }
}
const tac = new Tac()

// diagonal de corte: x de 0 a 1 é a posição da lâmina na largura
const slant = 0.13
function wipe(x: number, dir: number) {
  const a = (x + slant) * 100
  const b = (x - slant) * 100
  return dir > 0 ? `polygon(0% 0%, ${a}% 0%, ${b}% 100%, 0% 100%)` : `polygon(${a}% 0%, 100% 0%, 100% 100%, ${b}% 100%)`
}

function frameHTML(i: number) {
  const b = BEATS[i]
  return `<img src="${b.img}" alt="" /><p class="t-beat__w">${b.w}</p><p class="t-beat__c"><b>${String(i + 1).padStart(2, '0')} — ${b.k}</b>${b.c}</p>`
}

async function boot() {
  await document.fonts.ready
  await Promise.all(BEATS.map((b) => new Promise((r) => Object.assign(new Image(), { src: b.img, onload: r, onerror: r }))))

  // textos duplicados para os cortes no CSS
  $$('.t-h__nav a, .t-cut').forEach((a) => (a.dataset.t = a.textContent || ''))
  const sBtn = $<HTMLButtonElement>('.t-sound')
  const setSound = (on: boolean) => {
    sBtn.innerHTML = `Som ${on ? 'on' : 'off'}`
    sBtn.dataset.t = sBtn.textContent || ''
    sBtn.setAttribute('aria-pressed', String(on))
  }
  setSound(false)
  sBtn.addEventListener('click', () => {
    setSound(tac.toggle())
    tac.play(1)
  })

  // hero: a foto em lâminas
  const photo = $('.t-hero__photo')
  const SL = 9
  const slices: HTMLElement[] = []
  for (let i = 0; i < SL; i++) {
    const s = document.createElement('div')
    s.className = 't-slice'
    s.style.top = `${(i / SL) * 100}%`
    s.style.height = `calc(${100 / SL}% + 1px)`
    s.style.backgroundImage = `url(${photo.dataset.slices})`
    s.style.backgroundSize = `112vw 100vh`
    s.style.backgroundPosition = `center ${-(i / SL) * 100}vh`
    photo.appendChild(s)
    slices.push(s)
  }
  const heroLines = $$('.t-hero__l')
  heroLines.forEach((l) => (l.innerHTML = `<span>${l.innerHTML}</span>`))

  // história em batidas
  const fa = $('.t-beat__frame--a')
  const fb = $('.t-beat__frame--b')
  const blade = $('.t-beat__blade')
  const ticks = $('.t-beat__ticks')
  BEATS.forEach(() => ticks.appendChild(document.createElement('i')))
  const tickEls = $$('i', ticks)
  const setFrame = (el: HTMLElement, i: number) => {
    el.innerHTML = frameHTML(i)
    el.dataset.pos = String(BEATS[i].pos)
    el.toggleAttribute('data-fire', !!BEATS[i].fire)
    el.classList.toggle('is-color', !!BEATS[i].color)
  }
  let shown = 0
  setFrame(fa, 0)
  fb.style.clipPath = wipe(-0.3, 1)
  tickEls[0].classList.add('is-on')
  let cutTl: gsap.core.Timeline | null = null
  function cut(i: number) {
    if (i === shown) return
    cutTl?.progress(1)
    const dir = i > shown ? 1 : -1
    shown = i
    setFrame(fb, i)
    tickEls.forEach((t, k) => t.classList.toggle('is-on', k === i))
    tac.play(i / BEATS.length)
    const W = window.innerWidth
    const o = { x: dir > 0 ? -slant : 1 + slant }
    const end = dir > 0 ? 1 + slant : -slant
    const w = $('.t-beat__w', fb)
    cutTl = gsap
      .timeline({
        onComplete: () => {
          setFrame(fa, i)
          fb.style.clipPath = wipe(-0.3, 1)
          gsap.set(blade, { opacity: 0 })
          cutTl = null
        },
      })
      .set(blade, { opacity: 1 })
      .to(o, {
        x: end,
        duration: reduce ? 0.01 : 0.3,
        ease: 'power4.inOut',
        onUpdate: () => {
          // a lâmina segue a borda; o novo quadro fica do lado de onde ela veio
          fb.style.clipPath = dir > 0 ? wipe(o.x, 1) : wipe(o.x, -1)
          gsap.set(blade, { x: o.x * W, rotate: (Math.atan((2 * slant * W) / window.innerHeight) * 180) / Math.PI })
        },
      })
      .fromTo(w, { scale: 1.16, xPercent: -4 * dir }, { scale: 1, xPercent: 0, duration: 0.5, ease: 'expo.out' }, 0.12)
      .fromTo($('.t-beat__c', fb), { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'expo.out' }, 0.2)
  }
  const beatSec = $('.t-beat')

  // casas: fatias
  const slicesWrap = $('.t-slices')
  HOUSES.forEach((h, i) => {
    const a = document.createElement('a')
    a.className = 't-sl' + (i === 0 ? ' is-open' : '')
    a.href = '#'
    a.innerHTML = `<img src="${h.img}" alt="" /><span class="t-sl__n">${h.name}</span><span class="t-sl__i"><b>${h.name}</b><span>${h.meta}</span></span>`
    slicesWrap.appendChild(a)
  })
  const sls = $$('.t-sl')
  const open = (el: HTMLElement) => {
    if (el.classList.contains('is-open')) return
    sls.forEach((s) => s.classList.toggle('is-open', s === el))
    tac.play(0.6)
  }
  sls.forEach((s) => {
    s.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && open(s))
    s.addEventListener('click', (e) => {
      e.preventDefault()
      open(s)
    })
  })

  // entradas: frases cortadas, fatias que caem
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target as HTMLElement
        if (el.classList.contains('t-slices')) {
          gsap.from(sls, { yPercent: -110, duration: 0.7, ease: 'expo.out', stagger: 0.07 })
          sls.forEach((_, k) => setTimeout(() => tac.play(0.3 + k * 0.08), k * 70))
        } else {
          el.classList.add('is-in')
          setTimeout(() => tac.play(0.8), 380)
        }
        io.unobserve(el)
      }),
    { rootMargin: '0px 0px -22% 0px' },
  )
  $$('[data-cut]').forEach((el) => io.observe(el))
  io.observe(slicesWrap)

  // rodapé: arraste para cortar a marca
  const board = $('.t-f__board')
  const ma = $('.t-f__mark--a')
  const mb = $('.t-f__mark--b')
  const line = $<SVGLineElement>('.t-f__line line')
  let p1: { x: number; y: number } | null = null
  let healing: gsap.core.Timeline | null = null
  const local = (e: PointerEvent) => {
    const r = board.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const drawLine = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    line.setAttribute('x1', String(a.x))
    line.setAttribute('y1', String(a.y))
    line.setAttribute('x2', String(b.x))
    line.setAttribute('y2', String(b.y))
  }
  board.addEventListener('pointerdown', (e) => {
    p1 = local(e)
    board.setPointerCapture(e.pointerId)
    drawLine(p1, p1)
    gsap.set(line, { opacity: 1 })
  })
  board.addEventListener('pointermove', (e) => p1 && drawLine(p1, local(e)))
  board.addEventListener('pointerup', (e) => {
    if (!p1) return
    const p2 = local(e)
    const a = p1
    p1 = null
    const dx = p2.x - a.x
    const dy = p2.y - a.y
    const len = Math.hypot(dx, dy)
    gsap.to(line, { opacity: 0, duration: 0.4, delay: 0.05 })
    if (len < 30) return
    healing?.progress(1)
    const ux = dx / len
    const uy = dy / len
    const nx = -uy
    const ny = ux
    const L = 4000
    const P = (x: number, y: number) => `${x.toFixed(1)}px ${y.toFixed(1)}px`
    const half = (s: number) =>
      `polygon(${P(a.x - ux * L, a.y - uy * L)}, ${P(a.x + ux * L, a.y + uy * L)}, ${P(a.x + ux * L + nx * L * s, a.y + uy * L + ny * L * s)}, ${P(a.x - ux * L + nx * L * s, a.y - uy * L + ny * L * s)})`
    ma.style.clipPath = half(1)
    mb.style.clipPath = half(-1)
    mb.style.visibility = 'visible'
    mb.style.color = 'var(--fg)'
    tac.play(1)
    const k = 26
    healing = gsap
      .timeline({
        onComplete: () => {
          ma.style.clipPath = ''
          mb.style.visibility = 'hidden'
          healing = null
        },
      })
      .to(ma, { x: nx * k + ux * 10, y: ny * k + uy * 10, rotate: -1.6, duration: 0.5, ease: 'expo.out' }, 0)
      .to(mb, { x: -nx * k - ux * 10, y: -ny * k - uy * 10, rotate: 1.6, duration: 0.5, ease: 'expo.out' }, 0)
      .to([ma, mb], { x: 0, y: 0, rotate: 0, duration: 0.42, ease: 'power4.in' }, 1.5)
      .add(() => tac.play(0.2), 1.9)
  })

  // navegação
  $$('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      $((a as HTMLAnchorElement).getAttribute('href')!).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' })
    }),
  )
  $$('[data-top]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    }),
  )

  // quadro a quadro: lâminas do hero e batidas
  gsap.ticker.add(() => {
    const H = window.innerHeight
    const y = window.scrollY
    const p = clamp(y / (H * 0.9))
    slices.forEach((s, i) => {
      const side = i % 2 ? 1 : -1
      s.style.transform = `translate3d(${side * p * (30 + ((i * 37) % 90))}px, 0, 0)`
    })
    heroLines.forEach((l, i) => {
      l.style.transform = `translate3d(${(i % 2 ? 1 : -1) * p * 140}px, 0, 0)`
    })
    const r = beatSec.getBoundingClientRect()
    if (r.top < H && r.bottom > 0) {
      const bp = clamp(-r.top / (r.height - H))
      cut(Math.min(BEATS.length - 1, Math.floor(bp * BEATS.length)))
    }
  })

  // abertura: montagem no tempo, depois a facada
  const intro = $('.t-intro')
  const stages = $$('.t-intro__stage')
  const MONT = [
    { w: 'Alta', img: '/img/iz_rest.webp' },
    { w: 'gastro', img: '' },
    { w: 'nomia', img: '/img/caviar.webp' },
    { w: 'com', img: '' },
    { w: 'alma', img: '/img/nip_pizza.webp' },
    { w: 'regio', img: '' },
    { w: 'nal.', img: '/img/ian_chef.webp', fire: true },
  ]
  const show = (m: (typeof MONT)[number]) =>
    stages.forEach((s) => (s.innerHTML = `${m.img ? `<img src="${m.img}" alt="" />` : ''}<p class="t-intro__w${m.fire ? ' t-intro__w--fire' : ''}">${m.w}</p>`))
  const BEAT = reduce ? 0.05 : 0.36
  const tl = gsap.timeline({ delay: 0.4 })
  MONT.forEach((m, i) =>
    tl.add(() => {
      show(m)
      tac.play(i / MONT.length)
      gsap.fromTo($$('.t-intro__w'), { scale: 1.12 }, { scale: 1, duration: BEAT * 1.4, ease: 'expo.out' })
    }, i * BEAT),
  )
  tl.add(() => show({ w: 'ÍZ', img: '' }), MONT.length * BEAT)
    .to('.t-intro__blade', { scaleY: 1, duration: 0.16, ease: 'power3.in' }, MONT.length * BEAT + 0.5)
    .add(() => tac.play(1))
    .to('.t-intro__half--a', { xPercent: -70, yPercent: -12, duration: 1.0, ease: 'expo.inOut' }, '+=0.12')
    .to('.t-intro__half--b', { xPercent: 70, yPercent: 12, duration: 1.0, ease: 'expo.inOut' }, '<')
    .to('.t-intro__blade', { opacity: 0, duration: 0.2 }, '<')
    .from(heroLines.map((l) => l.firstElementChild), { yPercent: 105, duration: 1.0, stagger: 0.08, ease: 'expo.out' }, '<0.35')
    .add(() => {
      intro.remove()
      document.body.classList.remove('is-intro')
    })
}

boot()
