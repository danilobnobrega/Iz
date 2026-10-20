import './materia.css'
import * as THREE from 'three'
import gsap from 'gsap'
import Lenis from 'lenis'
import { Stage, shared, type Kind } from './gl/Materia'

// Proposta J: o "Íz" é um objeto. A cada casa ele muda de matéria;
// no fim vira 445 pessoas, depois 520, e volta a ser um só.

type State = {
  mat: Kind | 'swarm'
  bg: string
  edge: string
  dark?: boolean
  pose: [number, number, number] // x, y, escala
  pos: 'left' | 'center' | 'mid'
  html: string
}

const casa = (mat: Kind, bg: string, edge: string, n: string, name: string, meta: string, dark = false): State => ({
  mat,
  bg,
  edge,
  dark,
  pose: [1.05, 0.05, 0.92],
  pos: 'left',
  html: `<p class="mt-small" data-fade>${n}</p><h2 class="mt-name" data-words>${name}</h2><p class="mt-p" data-fade>${meta}</p>`,
})

const STATES: State[] = [
  { mat: 'porcelana', bg: '#dcd3c4', edge: '#ffb36b', pose: [0, 0.02, 0.92], pos: 'center', html: '<p class="mt-small" data-fade>Grupo de gastronomia · Goiânia · desde 2015</p>' },
  { mat: 'porcelana', bg: '#dcd3c4', edge: '#ffb36b', pose: [1.15, 0.05, 0.8], pos: 'mid', html: '<h2 class="mt-h2" data-words>Dois amigos de infância. <em>Um cozinheiro que voltou pra casa.</em></h2><p class="mt-p" data-fade>Ian Baiocchi e Domingos Ávila se conheceram no karatê. Ian cozinhou no D.O.M., no Maní, no El Celler de Can Roca e no Mugaritz. Voltou para Goiânia, e em 2016 Domingos virou sócio. Hoje são sete casas, cada uma com a sua matéria.</p>' },
  casa('porcelana', '#dcd3c4', '#ffb36b', '01', 'Íz', 'Contemporânea · Setor Marista · desde 2015'),
  casa('terracota', '#e6d3c2', '#ff8a4c', '02', '1929', 'Trattoria · o ano da avó, Dona Colombina'),
  casa('espelho', '#c9d3d9', '#a9dcff', '03', 'Grá', 'Bistrô francês · 192 metros acima de Goiânia'),
  casa('gelo', '#e4e0f0', '#c9b8ff', '04', 'Alata', 'Sorvete artesanal'),
  casa('brasa', '#1a1513', '#ff6a2a', '05', 'Fulles', 'Cozinha na lenha', true),
  casa('travertino', '#e8e0d1', '#ffcf8a', '06', 'Hotel', 'Íz Hotel Conceito · restaurant with rooms'),
  casa('laca', '#efe1bf', '#ff4a2a', '07', 'nip', 'Not in Napoli · Rua 1130'),
  { mat: 'swarm', bg: '#ece6dc', edge: '#ffb36b', pose: [0, 0.08, 1], pos: 'left', html: '<h2 class="mt-h2" data-words>445 pessoas. <em>50 mil clientes por mês.</em></h2><p class="mt-p" data-fade>Padaria, açougue e confeitaria próprios abastecem as casas.</p>' },
  { mat: 'swarm', bg: '#ece6dc', edge: '#ffb36b', pose: [0, 0.08, 1], pos: 'left', html: '<h2 class="mt-h2" data-words>520 em 2026. <em>Falta você.</em></h2><a class="mt-btn mt-btn--l" href="#" data-fade><span>Trabalhe conosco</span></a>' },
  { mat: 'porcelana', bg: '#dcd3c4', edge: '#ffb36b', pose: [0, 0.02, 0.92], pos: 'center', html: '<p class="mt-small" data-fade>Rua 1130, Setor Marista, Goiânia · proposta não oficial, por Danilo</p>' },
]
const SW445 = STATES.findIndex((s) => s.mat === 'swarm')

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
const lenis = reduce ? null : new Lenis({ lerp: 0.075, wheelMultiplier: 0.75 })
lenis?.stop()

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))

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
  const canvas = document.querySelector<HTMLCanvasElement>('.mt-gl')!
  const stage = new Stage(canvas)
  const load = document.querySelector<HTMLElement>('.mt-load')!
  const loadN = load.querySelector<HTMLElement>('.mt-load__n')!

  // textos
  const holder = document.querySelector<HTMLElement>('.mt-texts')!
  const texts = STATES.map((s) => {
    const el = document.createElement('div')
    el.className = `mt-t mt-t--${s.pos}`
    el.innerHTML = s.html
    splitWords(el)
    holder.appendChild(el)
    return el
  })
  document.querySelectorAll<HTMLElement>('.mt-btn span').forEach((s) => (s.dataset.t = s.textContent || ''))
  document.querySelector<HTMLElement>('.mt-scroll')!.style.height = `${STATES.length * 100}vh`

  // enxame: origem dentro do objeto, destino numa nuvem
  const N = 520
  const src: THREE.Vector3[] = []
  const cloud: THREE.Vector3[] = []
  const spin: THREE.Vector3[] = []
  const delay: number[] = []
  const bb = stage.geo.boundingBox!
  for (let i = 0; i < N; i++) {
    src.push(new THREE.Vector3(THREE.MathUtils.lerp(bb.min.x, bb.max.x, Math.random()), THREE.MathUtils.lerp(bb.min.y, bb.max.y, Math.random()), (Math.random() - 0.5) * 0.2))
    // espiral de Fibonacci num elipsoide achatado
    const k = i + 0.5
    const phi = Math.acos(1 - (2 * k) / N)
    const th = Math.PI * (1 + Math.sqrt(5)) * k
    const r = 0.55 + Math.random() * 0.45
    cloud.push(new THREE.Vector3(Math.cos(th) * Math.sin(phi) * 3.1 * r, Math.cos(phi) * 1.5 * r, Math.sin(th) * Math.sin(phi) * 1.3 * r))
    spin.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4))
    delay.push(Math.random())
  }

  // cursor e arraste
  const mouse = new THREE.Vector2(0, 0)
  const mouseWorld = new THREE.Vector3(99, 99, 0)
  let drag = false
  let lastX = 0
  let dragRot = 0
  let dragVel = 0
  const ray = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  window.addEventListener('pointermove', (e) => {
    mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    if (drag) {
      dragVel = (e.clientX - lastX) * 0.012
      dragRot += dragVel
      lastX = e.clientX
    }
  })
  canvas.addEventListener('pointerdown', (e) => {
    drag = true
    lastX = e.clientX
    canvas.classList.add('is-drag')
  })
  window.addEventListener('pointerup', () => {
    drag = false
    canvas.classList.remove('is-drag')
  })

  // carregamento: compila todas as matérias antes de mostrar
  const counter = { v: 0 }
  gsap.to(counter, { v: 100, duration: 1.6, ease: 'power2.inOut', onUpdate: () => void (loadN.textContent = String(Math.round(counter.v))) })
  await document.fonts.ready
  await stage.warm()
  await new Promise((r) => setTimeout(r, 1700))

  const tilt = { x: 0, y: 0 }
  const intro = { v: 0, dis: 0 }
  const bg = new THREE.Color(STATES[0].bg)
  const tmpC = new THREE.Color()
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e3 = new THREE.Euler()
  const v3 = new THREE.Vector3()
  const s3 = new THREE.Vector3()
  let seg = -1
  let active = -1
  const clock = new THREE.Clock()

  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime
    shared.uTime.value = t
    const vh = window.innerHeight
    const p = clamp(window.scrollY / vh, 0, STATES.length - 1)
    const k = Math.min(Math.floor(p), STATES.length - 2)
    const f = p - k
    const prog = ease(clamp((f - 0.2) / 0.6))
    const A = STATES[k]
    const B = STATES[k + 1]

    // matérias
    if (k !== seg) {
      seg = k
      const ma = A.mat === 'swarm' ? 'porcelana' : A.mat
      const mb = B.mat === 'swarm' ? ma : B.mat
      stage.setPair(ma, mb)
    }
    const matChange = A.mat !== 'swarm' && B.mat !== 'swarm' && A.mat !== B.mat
    shared.uProg.value = matChange ? prog : 0
    shared.uEdge.value.set(B.edge)
    // entrada: só a matéria "que entra" aparece, varrida de baixo pra cima
    const introing = intro.dis < 0.999
    stage.meshA.visible = !introing
    if (introing) shared.uProg.value = intro.dis

    // fundo e cor do texto
    tmpC.set(A.bg).lerp(new THREE.Color(B.bg), prog)
    bg.lerp(tmpC, 1 - Math.pow(0.001, dt))
    stage.scene.background = bg
    document.documentElement.style.background = '#' + bg.getHexString()
    const dark = (prog < 0.5 ? A : B).dark ?? false
    document.body.classList.toggle('on-dark', dark)
    stage.rim.color.set(B.edge).lerp(new THREE.Color('#ffffff'), 0.5)

    // pose: posição e escala, com uma volta completa enquanto a matéria troca
    const px = THREE.MathUtils.lerp(A.pose[0], B.pose[0], prog)
    const py = THREE.MathUtils.lerp(A.pose[1], B.pose[1], prog)
    let sc = THREE.MathUtils.lerp(A.pose[2], B.pose[2], prog)
    const mobile = window.innerWidth < 861
    // quanto do objeto grande está presente (some no enxame)
    let big = 1
    if (A.mat !== 'swarm' && B.mat === 'swarm') big = 1 - prog
    else if (A.mat === 'swarm' && B.mat === 'swarm') big = 0
    else if (A.mat === 'swarm' && B.mat !== 'swarm') big = prog
    sc *= Math.max(0.0001, big) * (0.92 + intro.v * 0.08)

    tilt.x += (mouse.y * 0.18 - tilt.x) * (1 - Math.pow(0.02, dt))
    tilt.y += (mouse.x * 0.4 - tilt.y) * (1 - Math.pow(0.02, dt))
    if (!drag) {
      dragVel *= Math.pow(0.05, dt)
      dragRot += dragVel
      dragRot *= Math.pow(0.6, dt) // volta devagar pra frente
    }
    stage.rig.position.set(mobile ? 0 : px, mobile ? 0.45 : py + Math.sin(t * 0.8) * 0.03, 0)
    stage.rig.scale.setScalar(sc * (mobile ? 0.8 : 1))
    stage.rig.rotation.set(tilt.x * -1 + Math.sin(t * 0.5) * 0.03, tilt.y + dragRot + (matChange ? prog * Math.PI * 2 : 0) + (1 - intro.v) * -1.2, 0)

    // enxame
    let count = 0
    if (A.mat === 'swarm' || B.mat === 'swarm') {
      ray.setFromCamera(mouse, stage.camera)
      ray.ray.intersectPlane(plane, mouseWorld)
      const kA = A.mat === 'swarm' ? (k === SW445 ? 445 : 520) : 0
      const kB = B.mat === 'swarm' ? (k + 1 === SW445 ? 445 : 520) : 0
      count = Math.max(kA, kB)
      const spread = A.mat === 'swarm' && B.mat === 'swarm' ? 1 + prog * 0.18 : k + 1 === SW445 ? 1 : 1.18
      for (let i = 0; i < count; i++) {
        // presença desta cópia em A e em B
        const inA = i < kA ? 1 : 0
        const inB = i < kB ? 1 : 0
        const local = clamp((prog * 1.5 - delay[i] * 0.5))
        const le = ease(local)
        const pres = inA + (inB - inA) * le
        // posição: de dentro do objeto até a nuvem (ou de volta)
        const fromObj = A.mat !== 'swarm'
        const toObj = B.mat !== 'swarm'
        const cl = v3.copy(cloud[i]).multiplyScalar(spread)
        const pos = new THREE.Vector3()
        if (fromObj) pos.copy(src[i]).lerp(cl, le)
        else if (toObj) pos.copy(cl).lerp(src[i], le)
        else pos.copy(cl)
        // deriva lenta e o cursor afastando
        const ang = t * 0.08
        const x = pos.x * Math.cos(ang) - pos.z * Math.sin(ang)
        const z = pos.x * Math.sin(ang) + pos.z * Math.cos(ang)
        pos.set(x, pos.y + Math.sin(t * 0.7 + i) * 0.03, z)
        const dx = pos.x - mouseWorld.x
        const dy = pos.y - mouseWorld.y
        const d = Math.hypot(dx, dy)
        if (d < 0.9 && d > 0.0001) {
          const push = (1 - d / 0.9) ** 2 * 0.55
          pos.x += (dx / d) * push
          pos.y += (dy / d) * push
          pos.z += push * 0.6
        }
        e3.set(spin[i].x * t, spin[i].y * t + i, spin[i].z * t)
        q.setFromEuler(e3)
        const s = 0.2 * pres
        m4.compose(pos.add(new THREE.Vector3(mobile ? 0 : 0.35, mobile ? 0.4 : 0.08, 0)), q, s3.setScalar(Math.max(0.0001, s)))
        stage.swarm.setMatrixAt(i, m4)
      }
      stage.swarm.instanceMatrix.needsUpdate = true
    }
    stage.swarm.count = count

    // texto da composição montada
    const near = Math.round(p)
    const on = Math.abs(p - near) < 0.2 ? near : -1
    if (on !== active) {
      active = on
      texts.forEach((el, i) => el.classList.toggle('is-on', i === on))
    }

    stage.render()
  })
  gsap.ticker.lagSmoothing(0)

  window.addEventListener('resize', () => stage.resize())
  document.querySelectorAll<HTMLAnchorElement>('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const y = Number(a.dataset.go) * window.innerHeight
      lenis ? lenis.scrollTo(y, { duration: 2.6 }) : window.scrollTo(0, y)
    }),
  )

  // entrada: o objeto se materializa de baixo pra cima com a borda incandescente
  load.classList.add('is-done')
  document.body.classList.remove('is-loading')
  stage.setPair('porcelana', 'porcelana')
  gsap.to(intro, { v: 1, duration: 2.6, ease: 'expo.out' })
  gsap.to(intro, { dis: 1, duration: 2.2, ease: 'power2.inOut', delay: 0.1 })
  setTimeout(() => lenis?.start(), 900)
}

boot()
