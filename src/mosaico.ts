import './mosaico.css'
import * as THREE from 'three'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Mosaic, gridLayout, glyphLayout, type Rect, type Tile } from './gl/Mosaic'

// Proposta H: o site inteiro é feito de 445 peças, uma por pessoa do grupo.

type State = {
  img: string
  kind: 'grid' | 'glyph'
  glyph?: string
  font?: string
  rect: [number, number, number, number] // fração da tela: x, y, w, h
  mrect?: [number, number, number, number] // celular
  pos: 'left' | 'right' | 'top' | 'bottom'
  html: string
}

const casa = (img: string, n: string, name: string, meta: string): State => ({
  img,
  kind: 'grid',
  rect: [0.04, 0.12, 0.6, 0.76],
  mrect: [0.05, 0.11, 0.9, 0.52],
  pos: 'right',
  html: `<p class="mo-small" data-fade>${n}</p><h2 class="mo-name" data-words>${name}</h2><p class="mo-p" data-fade>${meta}</p>`,
})

const STATES: State[] = [
  { img: '/img/iz_unnamed.webp', kind: 'glyph', glyph: 'Íz', rect: [0.16, 0.1, 0.68, 0.74], mrect: [0.06, 0.16, 0.88, 0.5], pos: 'bottom', html: '<p class="mo-small" data-fade>Grupo de gastronomia · Goiânia · desde 2015</p>' },
  { img: '/img/iz_unnamed.webp', kind: 'grid', rect: [0.4, 0.12, 0.56, 0.76], mrect: [0.05, 0.11, 0.9, 0.5], pos: 'left', html: '<h2 class="mo-h2" data-words>Alta gastronomia <em>com alma regional.</em></h2>' },
  { img: '/img/ian_neo.webp', kind: 'grid', rect: [0.52, 0.14, 0.34, 0.72], mrect: [0.12, 0.11, 0.76, 0.5], pos: 'left', html: '<h2 class="mo-h2" data-words>Dois amigos de infância. <em>Um cozinheiro que voltou pra casa.</em></h2><p class="mo-p" data-fade>Ian Baiocchi e Domingos Ávila se conheceram no karatê. Ian cozinhou no D.O.M., no Maní, no El Celler de Can Roca e no Mugaritz. Voltou para Goiânia. Em 2016, Domingos virou sócio.</p>' },
  { img: '/img/gra1.webp', kind: 'grid', rect: [0.04, 0.5, 0.92, 0.42], mrect: [0.05, 0.11, 0.9, 0.34], pos: 'top', html: '<div class="mo-princ"><div><h3 data-words>Cuidado, <em>não pompa.</em></h3><p data-fade>Reunião com o salão todo dia antes de abrir.</p></div><div><h3 data-words>Linguagem, <em>não regra.</em></h3><p data-fade>No nip, a Margherita é DOG.</p></div><div><h3 data-words>Local, <em>sem ser óbvio.</em></h3><p data-fade>Baru, cajuzinho, baunilha do cerrado.</p></div><div><h3 data-words>Nada de <em>acomodação.</em></h3><p data-fade>Padaria, açougue e confeitaria próprios.</p></div></div>' },
  casa('/img/iz_rest.webp', '01', 'Íz', 'Contemporânea · Setor Marista · desde 2015'),
  casa('/img/t1929.webp', '02', '1929', 'Trattoria · o ano da avó, Dona Colombina'),
  casa('/img/gra2.webp', '03', 'Grá', 'Bistrô francês · 192 metros acima de Goiânia'),
  casa('/img/nip_pistache.webp', '04', 'Alata', 'Sorvete artesanal'),
  casa('/img/nip_polpetone.webp', '05', 'Fulles', 'Cozinha na lenha'),
  casa('/img/iz_9.webp', '06', 'Hotel', 'Íz Hotel Conceito · restaurant with rooms'),
  casa('/img/nip_fachada.webp', '07', 'nip', 'Not in Napoli · Rua 1130'),
  { img: '/img/ian_chef.webp', kind: 'glyph', glyph: '445', font: "'Archivo Variable'", rect: [0.04, 0.16, 0.6, 0.62], mrect: [0.05, 0.14, 0.9, 0.36], pos: 'right', html: '<h2 class="mo-h2" data-words>pessoas. <em>Cada peça desta página é uma delas.</em></h2><p class="mo-p" data-fade>50 mil clientes por mês. Padaria, açougue e confeitaria próprios abastecem as casas.</p>' },
  { img: '/img/socios.webp', kind: 'glyph', glyph: '520', font: "'Archivo Variable'", rect: [0.04, 0.16, 0.6, 0.62], mrect: [0.05, 0.14, 0.9, 0.36], pos: 'right', html: '<h2 class="mo-h2" data-words>em 2026. <em>Falta você.</em></h2><a class="mo-btn mo-btn--l" href="#" data-fade><span>Trabalhe conosco</span></a>' },
  { img: '/img/iz_unnamed.webp', kind: 'glyph', glyph: 'Íz', rect: [0.16, 0.1, 0.68, 0.74], mrect: [0.06, 0.16, 0.88, 0.5], pos: 'bottom', html: '<p class="mo-small" data-fade>Rua 1130, Setor Marista, Goiânia · proposta não oficial, por Danilo</p>' },
]

const FONT = "'Fraunces Variable'"

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.08, wheelMultiplier: 0.8 })
lenis?.stop()

function splitWords(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-words]').forEach((el) => {
    let i = 0
    const walk = (node: Node, parent: HTMLElement) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          ;(child.textContent || '').split(/(\s+)/).forEach((part) => {
            if (!part) return
            if (/^\s+$/.test(part)) return void parent.appendChild(document.createTextNode(' '))
            const wd = document.createElement('span')
            wd.className = 'wd'
            const inner = document.createElement('span')
            inner.textContent = part
            inner.style.setProperty('--i', String(i++))
            wd.appendChild(inner)
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
  })
}

async function boot() {
  const mosaic = new Mosaic(document.querySelector<HTMLCanvasElement>('.mo-gl')!)
  await document.fonts.load("900 100px 'Fraunces Variable'")
  await document.fonts.load("900 100px 'Archivo Variable'")
  await document.fonts.ready

  // texturas
  const loader = new THREE.TextureLoader()
  const tex = new Map<string, THREE.Texture>()
  await Promise.all(
    [...new Set(STATES.map((s) => s.img))].map(
      (src) =>
        new Promise<void>((resolve) =>
          loader.load(src, (t) => {
            t.colorSpace = THREE.NoColorSpace
            t.anisotropy = 8
            tex.set(src, t)
            resolve()
          }),
        ),
    ),
  )
  const aspect = (src: string) => {
    const img = tex.get(src)!.image as HTMLImageElement
    return img.width / img.height
  }

  // textos
  const holder = document.querySelector<HTMLElement>('.mo-texts')!
  const texts = STATES.map((s) => {
    const el = document.createElement('div')
    el.className = `mo-t mo-t--${s.pos}`
    el.innerHTML = s.html
    splitWords(el)
    holder.appendChild(el)
    return el
  })
  document.querySelectorAll<HTMLElement>('.mo-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))
  document.querySelector<HTMLElement>('.mo-scroll')!.style.height = `${STATES.length * 100}vh`

  // composições (refeitas ao redimensionar)
  let layouts: Tile[][] = []
  const build = () => {
    const W = window.innerWidth
    const H = window.innerHeight
    const mobile = W < 861
    layouts = STATES.map((s) => {
      const f = mobile && s.mrect ? s.mrect : s.rect
      const r: Rect = { x: f[0] * W, y: f[1] * H, w: f[2] * W, h: f[3] * H }
      return s.kind === 'glyph' ? glyphLayout(s.glyph!, r, aspect(s.img), s.font || FONT) : gridLayout(r, aspect(s.img))
    })
    seg = -1
  }

  let seg = -1
  let active = -1
  const setSeg = (k: number) => {
    if (k === seg) return
    seg = k
    const b = Math.min(k + 1, STATES.length - 1)
    const dk = (s: State) => (s.kind === 'glyph' ? 0.75 : 0)
    mosaic.setPair(layouts[k], layouts[b], tex.get(STATES[k].img)!, tex.get(STATES[b].img)!, k % 2 ? -1 : 1, dk(STATES[k]), dk(STATES[b]))
  }
  build()

  const intro = { t: 0 }
  let mx = -9999
  let my = -9999
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
  })

  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const vh = window.innerHeight
    const p = Math.min(STATES.length - 1, Math.max(0, window.scrollY / vh))
    const k = Math.min(Math.floor(p), STATES.length - 2)
    setSeg(k)
    // cada composição segura um instante antes de começar a se desfazer
    const f = p - k
    const t = Math.min(1, Math.max(0, (f - 0.22) / 0.56))
    // texto só aparece quando a composição está montada
    const near = Math.round(p)
    const on = Math.abs(p - near) < 0.22 ? near : -1
    if (on !== active) {
      active = on
      texts.forEach((el, i) => el.classList.toggle('is-on', i === on))
    }
    mosaic.mat.uniforms.uLift.value = 160 * intro.t + 40
    mosaic.render(t, time, mx, my)
  })
  gsap.ticker.lagSmoothing(0)

  window.addEventListener('resize', () => {
    mosaic.resize()
    build()
  })

  document.querySelectorAll<HTMLAnchorElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const y = Number(a.dataset.go) * window.innerHeight
      lenis ? lenis.scrollTo(y, { duration: 2.4 }) : window.scrollTo(0, y)
    }),
  )

  document.body.classList.remove('is-loading')
  gsap.to(intro, { t: 1, duration: 1.2 })
  setTimeout(() => lenis?.start(), 600)
}

boot()
