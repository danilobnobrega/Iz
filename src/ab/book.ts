import * as THREE from 'three'
import { Section, damp, ease, fit, toScreen, type Ctx, type Rect } from '../y/core'
import * as P from './pages'

// O livro inteiro. Folhas são planos que viram em torno da lombada (eixo z) com curvatura de papel
// (o ângulo cresce em direção à borda livre, integrado ao longo da folha). Cada página dupla tem um
// mecanismo: letras pop-up, livro-túnel com a foto em camadas de profundidade, disco giratório
// atrás de uma janela, abas que levantam, carrossel de cartões e o "520".

const W = 3 // largura da página
const H = 4 // altura da página (eixo z)
const GAP = 0.007 // espessura de cada folha na pilha
const NL = 7 // folhas: capa + 5 + contracapa

const BEND_HEAD = /* glsl */ `
  uniform float uTheta, uCurl, uY;
  vec3 bendP(vec3 p, out vec3 nrm){
    float s = p.x; float ds = s / 20.0; vec2 acc = vec2(0.0); float a = uTheta;
    for (int i = 0; i < 20; i++) {
      float si = (float(i) + 0.5) * ds;
      a = uTheta + uCurl * pow(si / ${W.toFixed(1)}, 1.4) * sin(uTheta);
      acc += vec2(cos(a), sin(a)) * ds;
    }
    nrm = vec3(-sin(a), cos(a), 0.0);
    return vec3(acc.x, acc.y + uY, p.z);
  }
`

type Leaf = { front: THREE.Mesh; back: THREE.Mesh; u: { uTheta: { value: number }; uCurl: { value: number }; uY: { value: number } } }
type Pop = { obj: THREE.Object3D; spread: number; update: (r: number, local: number, c: Ctx) => void }

export class BookSec extends Section {
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100)
  leaves: Leaf[] = []
  pops: Pop[] = []
  camPos = new THREE.Vector3(0, 9, 9)
  camTgt = new THREE.Vector3(1.5, 0, 0)
  disc!: THREE.Mesh
  discRot = 0
  discVel = 0
  lastPX = 0
  dragging = false
  ray = new THREE.Raycaster()
  flaps: THREE.Object3D[] = []
  flapOpen = [0, 0, 0, 0]
  ready = false

  constructor(el: HTMLElement) {
    super(el)
    this.scene.background = new THREE.Color('#14100d')
    this.scene.fog = new THREE.Fog('#14100d', 16, 30)
    // mesa de madeira escura
    const wood = P.canvas(1024, 1024)
    const g = wood.x.createLinearGradient(0, 0, 1024, 0)
    g.addColorStop(0, '#3a2618')
    g.addColorStop(1, '#2c1c12')
    wood.x.fillStyle = g
    wood.x.fillRect(0, 0, 1024, 1024)
    for (let i = 0; i < 260; i++) {
      wood.x.strokeStyle = `rgba(${20 + Math.random() * 40},${12 + Math.random() * 20},${6 + Math.random() * 10},${0.15 + Math.random() * 0.25})`
      wood.x.lineWidth = 1 + Math.random() * 3
      wood.x.beginPath()
      const y = Math.random() * 1024
      wood.x.moveTo(0, y)
      for (let xx = 0; xx <= 1024; xx += 32) wood.x.lineTo(xx, y + Math.sin(xx * 0.01 + i) * 8 + Math.sin(xx * 0.003 + i * 2) * 20)
      wood.x.stroke()
    }
    const wt = P.tex(wood.c)
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping
    wt.repeat.set(3, 3)
    const table = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: wt, roughness: 0.55 }))
    table.rotation.x = -Math.PI / 2
    table.position.y = -0.03
    table.receiveShadow = true
    this.scene.add(table)
    this.scene.add(new THREE.HemisphereLight('#fff3e2', '#2a1a10', 1.0))
    const key = new THREE.DirectionalLight('#ffe9cc', 2.6)
    key.position.set(-5, 9, 6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const sc = key.shadow.camera as THREE.OrthographicCamera
    sc.left = -6
    sc.right = 6
    sc.top = 6
    sc.bottom = -6
    sc.near = 1
    sc.far = 30
    key.shadow.bias = -0.0005
    key.shadow.normalBias = 0.02
    key.shadow.radius = 4
    this.scene.add(key)
  }

  leaf(front: THREE.Texture, back: THREE.Texture, stiff = false): Leaf {
    const geo = new THREE.PlaneGeometry(W, H, stiff ? 2 : 48, 2)
    geo.rotateX(-Math.PI / 2)
    geo.translate(W / 2, 0, 0)
    const u = { uTheta: { value: 0 }, uCurl: { value: stiff ? 0 : 0.7 }, uY: { value: 0 } }
    const mk = (map: THREE.Texture, side: THREE.Side) => {
      const m = new THREE.MeshStandardMaterial({ map, side, roughness: 0.85, alphaTest: 0.5 })
      m.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, u)
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\n' + BEND_HEAD)
          .replace('#include <beginnormal_vertex>', 'vec3 nB; bendP(position, nB); vec3 objectNormal = nB;')
          .replace('#include <begin_vertex>', 'vec3 nB2; vec3 transformed = bendP(position, nB2);')
      }
      const mesh = new THREE.Mesh(geo, m)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5, map })
      dm.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, u)
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + BEND_HEAD).replace('#include <begin_vertex>', 'vec3 nB2; vec3 transformed = bendP(position, nB2);')
      }
      mesh.customDepthMaterial = dm
      this.scene.add(mesh)
      return mesh
    }
    // o verso é visto espelhado: inverte a textura para ler direito quando a folha está à esquerda
    back.wrapS = THREE.RepeatWrapping
    back.repeat.x = -1
    back.offset.x = 1
    return { front: mk(front, THREE.FrontSide), back: mk(back, THREE.BackSide), u }
  }

  // mecanismo preso à página da direita de uma página dupla (coordenadas da página: x 0..W, z −H/2..H/2)
  pop(spread: number, obj: THREE.Object3D, update: Pop['update']) {
    this.scene.add(obj)
    this.pops.push({ obj, spread, update })
  }

  // cartão em pé (articulado na base): sobe de deitado a vertical
  standCard(t: THREE.Texture, w: number, h: number, x: number, z: number, faceBack = false) {
    const hinge = new THREE.Group()
    hinge.position.set(x, 0, z)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8, alphaTest: 0.5 }))
    m.position.y = h / 2
    m.castShadow = true
    m.receiveShadow = true
    m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 })
    if (faceBack) m.rotation.y = Math.PI
    hinge.add(m)
    return hinge
  }

  async init() {
    await Promise.all([document.fonts.load('300 60px "Fraunces Variable"'), document.fonts.load('italic 40px "Instrument Serif"'), document.fonts.load('500 20px "JetBrains Mono Variable"')])
    const base = import.meta.env.BASE_URL
    // folhas: [frente (direita), verso (esquerda)]
    const L = [
      [P.coverTex(), P.textPage('O nome', 'Íz é paladar, em húngaro.', 'Sete casas em Goiânia, um jeito só de cozinhar: cuidado com cada detalhe, sem pompa nenhuma.', '')],
      [P.plainPage('1', 'abra devagar'), P.textPage('A origem', 'Dois amigos de infância.', 'Ian Baiocchi e Domingos Ávila se conheceram no karatê. O Íz abriu em 2015; a sociedade, em 2016.', '2')],
      [P.plainPage('3', 'livro-túnel'), P.textPage('A trajetória', 'Rodou o mundo, voltou pra casa.', '“O caminho mais fácil para um cozinheiro talvez fosse ficar em São Paulo.” — Ian Baiocchi', '4')],
      [P.windowPage('5'), P.textPage('Como a gente pensa', 'Quatro frases.', 'Levante as abas. Ou passe o cursor por cima delas.', '6')],
      [this.flapsPage(), P.textPage('As casas', 'Sete casas, um mesmo cuidado.', 'Do Íz, em 2015, ao nip, em 2026.', '8')],
      [P.plainPage('9'), P.textPage('Trabalhe conosco', '445 pessoas hoje.', 'Em 2026, 520. Cozinha, salão, hotel e escritório.', '10')],
      [P.plainPage('11'), P.backCoverTex()],
    ]
    L.forEach(([f, b], i) => this.leaves.push(this.leaf(f, b, i === 0 || i === NL - 1)))

    // página dupla 1: o nome em pop-up
    const iz = P.cardText('Íz', 1000, 760, 640, P.INK)
    const izCard = this.standCard(iz.t, 2.2, 1.67, W / 2, 0.2)
    const sub = P.cardText('paladar', 900, 260, 200, P.ACC)
    const subCard = this.standCard(sub.t, 1.6, 0.46, W / 2, 1.0)
    const g1 = new THREE.Group()
    g1.add(izCard, subCard)
    this.pop(1, g1, (r) => {
      izCard.rotation.x = -(1 - r) * Math.PI / 2
      subCard.rotation.x = -(1 - ease(Math.max(0, r * 1.3 - 0.3))) * Math.PI / 2
    })

    // página dupla 2: livro-túnel com a foto dos sócios em camadas
    const layers = await P.depthLayers('socios', [0.72, 0.5, 0.3, 0])
    const g2 = new THREE.Group()
    const tun: THREE.Object3D[] = []
    layers.forEach((l, k) => {
      const w = 2.5
      const h = w / l.aspect
      const card = this.standCard(l.t, w, h, W / 2, 1.1 - k * 0.55)
      tun.push(card)
      g2.add(card)
    })
    this.pop(2, g2, (r) => tun.forEach((t, k) => (t.rotation.x = -(1 - ease(Math.max(0, Math.min(1, r * 1.4 - k * 0.12)))) * Math.PI / 2)))

    // página dupla 3: disco giratório atrás da janela
    const items: [string, string][] = [
      ['D.O.M.', 'São Paulo'],
      ['Maní', 'São Paulo'],
      ['El Celler de Can Roca', 'Girona'],
      ['Mugaritz', 'Errenteria'],
      ['Goiânia', 'de volta, 2015'],
    ]
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(2.1, 128), new THREE.MeshStandardMaterial({ map: P.wheelTex(items), roughness: 0.8 }))
    this.disc.rotation.x = -Math.PI / 2
    // o disco fica entre a folha da janela e a folha de baixo
    this.disc.position.y = -GAP * 0.6 - 0.003
    this.disc.receiveShadow = true
    const discG = new THREE.Group()
    discG.add(this.disc)
    const winZ = -H / 2 + (430 / P.PH) * H
    discG.position.set(W / 2, 0, winZ + 1.39)
    this.pop(3, discG, (r) => {
      discG.visible = r > 0.02
    })

    // página dupla 4: abas
    const g4 = new THREE.Group()
    for (let k = 0; k < 4; k++) {
      const flapT = P.cardText(['Cuidado', 'Linguagem', 'Local', 'Nada'][k] + ' →', 900, 260, 150, P.PAPER, '#b8462e')
      const hinge = new THREE.Group()
      const zTop = -H / 2 + 0.45 + k * 0.85
      hinge.position.set(W / 2, 0.004, zTop)
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.66), new THREE.MeshStandardMaterial({ map: flapT.t, side: THREE.FrontSide, roughness: 0.8 }))
      m.rotation.x = -Math.PI / 2
      m.position.z = 0.33
      m.castShadow = true
      // verso da aba: papel vermelho liso, sem o texto espelhado
      const bk = new THREE.Mesh(m.geometry, new THREE.MeshStandardMaterial({ color: '#9c3b27', side: THREE.BackSide, roughness: 0.85 }))
      bk.rotation.copy(m.rotation)
      bk.position.copy(m.position)
      hinge.add(m, bk)
      g4.add(hinge)
      this.flaps.push(hinge)
    }
    this.pop(4, g4, (r, local, c) => {
      this.flaps.forEach((f, k) => {
        const auto = fit(local, 0.1 + k * 0.2, 0.28 + k * 0.2)
        this.flapOpen[k] += (Math.max(auto, this.hoverFlap === k ? 1 : 0) - this.flapOpen[k]) * damp(0.12, c.dt)
        f.rotation.x = -ease(this.flapOpen[k]) * 1.45
        f.visible = r > 0.02
      })
    })

    // página dupla 5: carrossel de casas
    const houses: [string, string][] = [
      ['Íz', 'iz_unnamed'],
      ['1929', 't1929'],
      ['Grá', 'gra1'],
      ['Alata', 'sorvete'],
      ['Fulles', ''],
      ['Hotel', 'iz_9'],
      ['nip', 'nip_fachada'],
    ]
    const g5 = new THREE.Group()
    const cards = await Promise.all(
      houses.map(async ([name, img]) => (img ? P.photoCard(`${base}img/${img}.webp`, 600, 800, name) : P.cardText(name, 600, 800, 200, P.INK, '#f6f0e4').t)),
    )
    const car: THREE.Object3D[] = []
    cards.forEach((t, k) => {
      const a = (k / (houses.length - 1) - 0.5) * 2.4
      const card = this.standCard(t, 0.75, 1.0, W / 2 + Math.sin(a) * 1.05, Math.cos(a) * -0.9 + 0.5)
      card.rotation.y = a * 0.85
      car.push(card)
      g5.add(card)
    })
    this.pop(5, g5, (r) =>
      car.forEach((cd, k) => {
        const rr = ease(Math.max(0, Math.min(1, r * 1.6 - k * 0.09)))
        cd.children[0].rotation.x = -(1 - rr) * Math.PI / 2
      }),
    )

    // página dupla 6: 520
    const n520 = P.cardText('520', 1000, 600, 520, P.ACC)
    const c520 = this.standCard(n520.t, 2.5, 1.5, W / 2, 0.3)
    this.pop(6, c520, (r) => (c520.rotation.x = -(1 - r) * Math.PI / 2))
    this.ready = true
  }

  flapsPage() {
    const { c, x } = P.canvas()
    x.fillStyle = P.PAPER
    x.fillRect(0, 0, P.PW, P.PH)
    const phr = ['Cuidado, não pompa.', 'Linguagem, não regra.', 'Local, sem ser óbvio.', 'Nada de acomodação.']
    x.fillStyle = P.INK
    x.textAlign = 'center'
    x.font = `300 74px "Fraunces Variable"`
    phr.forEach((t, k) => x.fillText(t, P.PW / 2, ((0.45 + k * 0.85 + 0.42) / H) * P.PH + 24))
    x.font = `500 26px "JetBrains Mono Variable"`
    x.textAlign = 'right'
    x.fillText('7', P.PW - 90, P.PH - 80)
    return P.tex(c)
  }

  hoverFlap = -1

  resize(w: number, h: number, dpr: number) {
    super.resize(w, h, dpr)
    this.cam.aspect = w / h
    this.cam.fov = w / h < 1 ? 58 : 32
    this.cam.updateProjectionMatrix()
  }

  update(p: number, c: Ctx, rect: Rect) {
    if (!this.ready) return
    const S = NL - 1 // viradas possíveis
    const u = fit(p, 0.02, 0.98) * S
    // ângulo de cada folha
    const thetas = this.leaves.map((_, i) => (i < NL - 1 ? Math.PI * ease(fit(u, i + 0.55, i + 0.95)) : 0))
    this.leaves.forEach((lf, i) => {
      const th = thetas[i]
      lf.u.uTheta.value = th
      // altura na pilha: à direita as folhas de baixo; à esquerda, em ordem inversa
      const yR = (NL - i) * GAP
      const yL = i * GAP
      lf.u.uY.value = yR + (yL - yR) * (th / Math.PI) + Math.sin(th) * 0.0
      lf.u.uCurl.value = i === 0 || i === NL - 1 ? 0 : 0.7 * (1 - Math.abs(th / Math.PI - 0.5) * 0.4)
    })
    // página dupla atual e quanto ela está aberta
    const spread = Math.max(0, Math.min(S, Math.floor(u) + (u - Math.floor(u) > 0.75 ? 1 : 0)))
    this.pops.forEach((pp) => {
      const k = pp.spread
      const open = k === 0 ? 1 : thetas[k - 1] / Math.PI
      // dobra antes de a página da direita virar
      const close = k < NL - 1 ? 1 - fit(u, k + 0.4, k + 0.56) : 1
      const r = Math.max(0, Math.min(open * 1.15 - 0.15, close))
      pp.obj.visible = r > 0.001
      // o mecanismo fica sobre a folha da direita (folha k)
      pp.obj.position.y = (NL - k) * GAP + 0.003
      pp.update(ease(Math.min(1, Math.max(0, r))), fit(u - k, 0.0, 0.42), c)
    })
    // disco: gira com a rolagem dentro da página e com o arrasto do cursor
    const m = this.local(c, rect)
    if (spread === 3) {
      const local = fit(u, 3.0, 3.42)
      const target = -local * Math.PI * 2 * (4 / 5)
      if (c.ptr.down && m.inside) {
        this.discVel = (c.ptr.px - this.lastPX) * 0.006
        this.discRot += this.discVel
      } else {
        this.discRot += (target - this.discRot) * damp(0.05, c.dt)
      }
      this.disc.rotation.z = this.discRot
    }
    this.lastPX = c.ptr.px
    // aba sob o cursor
    this.hoverFlap = -1
    if (spread === 4 && m.inside) {
      this.ray.setFromCamera(new THREE.Vector2(m.x, m.y), this.cam)
      const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(NL - 4) * GAP), new THREE.Vector3())
      if (hit && hit.x > 0.3 && hit.x < W - 0.3) {
        const k = Math.floor((hit.z + H / 2 - 0.45) / 0.85)
        if (k >= 0 && k < 4) this.hoverFlap = k
      }
    }
    // câmera por página dupla
    const shots = [
      { p: [1.5, 8.5, 6.2], t: [1.5, 0, 0.2] }, // capa fechada
      { p: [0.6, 5.2, 6.8], t: [0.4, 0.4, 0.2] }, // pop-up
      { p: [1.6, 2.6, 6.6], t: [1.3, 0.6, 0] }, // túnel: baixo, de frente
      { p: [1.4, 7.4, 2.4], t: [1.4, 0, -0.6] }, // disco: de cima
      { p: [0.3, 6.4, 5.4], t: [0.6, 0, 0.1] }, // abas
      { p: [2.6, 3.4, 5.8], t: [1.3, 0.5, 0.1] }, // carrossel: de lado
      { p: [0.8, 3.6, 6.4], t: [1.0, 0.5, 0.2] }, // 520
    ]
    const i0 = Math.min(shots.length - 1, Math.floor(u))
    const i1 = Math.min(shots.length - 1, i0 + 1)
    const f = ease(fit(u - i0, 0.5, 1.0))
    const narrow = rect.w / rect.h < 1
    const cp = new THREE.Vector3(...(shots[i0].p as [number, number, number])).lerp(new THREE.Vector3(...(shots[i1].p as [number, number, number])), f)
    const ct = new THREE.Vector3(...(shots[i0].t as [number, number, number])).lerp(new THREE.Vector3(...(shots[i1].t as [number, number, number])), f)
    if (narrow) cp.sub(ct).multiplyScalar(1.35).add(ct)
    cp.x += (m.inside ? m.x : 0) * 0.5
    cp.y += (m.inside ? m.y : 0) * 0.3
    this.camPos.lerp(cp, damp(0.08, c.dt))
    this.camTgt.lerp(ct, damp(0.08, c.dt))
    this.cam.position.copy(this.camPos)
    this.cam.lookAt(this.camTgt)
  }

  render(c: Ctx, rect: Rect) {
    toScreen(c, rect, this.scene, this.cam)
  }
}
