import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import glyph from '../data/iz-glyph.json'

// Proposta Q — "A planta". O desenho do Íz (contornos reais da Fraunces) é a planta
// baixa de uma galeria: paredes de gesso erguidas sobre o contorno, a céu aberto.
// As fotos das casas ficam penduradas nas paredes como obras. A câmera desce da
// vista aérea e caminha pelas galerias.

type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

export const S = 40 // metros por unidade da fonte
export const WALL_H = 4.2
const WALL_T = 1.1
const bb = glyph.bbox
// coordenada normalizada da planta (0..1, como na imagem de estudo) → mundo
export const P = (nx: number, ny: number) => new THREE.Vector2((bb.x1 + nx * (bb.x2 - bb.x1)) * S, (bb.y1 + ny * (bb.y2 - bb.y1)) * S)
const CENTER = P(0.5, 0.5)

function contours(): THREE.Vector2[][] {
  const sp = new THREE.ShapePath()
  for (const c of glyph.iz as Cmd[]) {
    if (c.type === 'M') sp.moveTo(c.x! * S, c.y! * S)
    else if (c.type === 'L') sp.lineTo(c.x! * S, c.y! * S)
    else if (c.type === 'Q') sp.quadraticCurveTo(c.x1! * S, c.y1! * S, c.x! * S, c.y! * S)
    else if (c.type === 'C') sp.bezierCurveTo(c.x1! * S, c.y1! * S, c.x2! * S, c.y2! * S, c.x! * S, c.y! * S)
  }
  return sp.subPaths.map((p) => {
    const pts = p.getSpacedPoints(Math.max(24, Math.round(p.getLength() / 0.6)))
    if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-3) pts.pop()
    return pts
  })
}

// ponto dentro da planta (regra par-ímpar sobre todos os contornos)
function inside(pt: THREE.Vector2, cs: THREE.Vector2[][]) {
  let c = false
  for (const poly of cs)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
    }
  return c
}

// paredes: o contorno vira uma faixa com espessura, erguida até WALL_H.
// aOrder (0..1 ao longo do contorno) deixa as paredes subirem em sequência na abertura
function walls(cs: THREE.Vector2[][]) {
  const pos: number[] = []
  const ord: number[] = []
  const idx: number[] = []
  let base = 0
  cs.forEach((poly, ci) => {
    const n = poly.length
    // normal apontando para fora do material (para o interior da galeria fica o lado de dentro da letra)
    // o lado de fora da letra é decidido uma vez por contorno (num trecho reto), e vale pro contorno todo
    const side = (() => {
      let votes = 0
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 24))) {
        const t = poly[(i + 1) % n].clone().sub(poly[i]).normalize()
        const nrm = new THREE.Vector2(-t.y, t.x)
        votes += inside(poly[i].clone().add(nrm.multiplyScalar(0.3)), cs) ? 1 : -1
      }
      return votes >= 0 ? -1 : 1 // multiplica a normal (-t.y, t.x) para apontar pra fora
    })()
    const off: THREE.Vector2[] = []
    for (let i = 0; i < n; i++) {
      const a = poly[(i - 1 + n) % n]
      const b = poly[(i + 1) % n]
      const t = b.clone().sub(a).normalize()
      off.push(poly[i].clone().add(new THREE.Vector2(-t.y, t.x).multiplyScalar(side * WALL_T)))
    }
    const ringO = off
    const ringI = poly
    for (let i = 0; i < n; i++) {
      const o = (ci + i / n) / cs.length
      for (const [p, y] of [
        [ringI[i], 0],
        [ringI[i], WALL_H],
        [ringO[i], 0],
        [ringO[i], WALL_H],
      ] as [THREE.Vector2, number][]) {
        pos.push(p.x, y, p.y)
        ord.push(o)
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 4
      const b = base + ((i + 1) % n) * 4
      // face interna, face externa, topo
      idx.push(a, b, a + 1, b, b + 1, a + 1)
      idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3)
      idx.push(a + 1, b + 1, a + 3, b + 1, b + 3, a + 3)
    }
    base += n * 4
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aOrder', new THREE.Float32BufferAttribute(ord, 1))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export type Art = { mesh: THREE.Group; house: number; pos: THREE.Vector3 }

export class Planta {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
  composer!: EffectComposer
  sun = new THREE.DirectionalLight('#ffeedd', 4.4)
  rise = { v: 0 } // paredes subindo (0..1)
  arts: Art[] = []
  path!: THREE.CatmullRomCurve3
  look!: THREE.CatmullRomCurve3
  progress = 0
  private wallMat!: THREE.MeshStandardMaterial
  private riseU = { value: 0 }
  private loader = new THREE.TextureLoader()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const sky = new THREE.Color('#e9e2d6')
    this.scene.background = sky
    this.scene.fog = new THREE.Fog(sky, 120, 320)
    this.scene.add(new THREE.HemisphereLight('#fffaf1', '#b9ab93', 0.75))
    this.sun.position.set(CENTER.x - 46, 34, CENTER.y - 30)
    this.sun.target.position.set(CENTER.x, 0, CENTER.y)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(4096, 4096)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.04
    this.sun.shadow.radius = 4
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -42
    sc.right = sc.top = 42
    sc.near = 1
    sc.far = 160
    this.scene.add(this.sun, this.sun.target)
  }

  async build(images: string[], onProgress: (p: number) => void) {
    const cs = contours()

    // chão externo (areia clara) e piso interno (pedra)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: '#d6ccbb', roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.set(CENTER.x, -0.01, CENTER.y)
    ground.receiveShadow = true
    this.scene.add(ground)
    const floorGeo = new THREE.ShapeGeometry(cs.map((c) => new THREE.Shape(c)))
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: '#b9ab95', roughness: 0.8, side: THREE.DoubleSide }))
    floor.rotation.x = Math.PI / 2
    floor.position.y = 0.01
    floor.receiveShadow = true
    this.scene.add(floor)

    // paredes
    this.wallMat = new THREE.MeshStandardMaterial({ color: '#f1ece3', roughness: 0.92, side: THREE.DoubleSide })
    this.wallMat.onBeforeCompile = (sh) => {
      sh.uniforms.uRise = this.riseU
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aOrder;\nuniform float uRise;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float k = clamp((uRise * 1.5 - aOrder * 0.5) / 1.0, 0.0, 1.0);
          k = k * k * (3.0 - 2.0 * k);
          transformed.y *= max(k, 0.0005);`,
        )
    }
    const wallGeo = walls(cs)
    const w = new THREE.Mesh(wallGeo, this.wallMat)
    w.castShadow = true
    w.receiveShadow = true
    // a sombra também precisa subir junto
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    depth.onBeforeCompile = this.wallMat.onBeforeCompile
    w.customDepthMaterial = depth
    this.scene.add(w)

    // obras: de um ponto dentro da galeria, anda numa direção até a parede e pendura ali
    const dims = new THREE.Vector2(bb.x2 - bb.x1, bb.y2 - bb.y1)
    const hit = (from: [number, number], dir: [number, number]) => {
      const o = P(from[0], from[1])
      const d = new THREE.Vector2(dir[0] * dims.x, dir[1] * dims.y).normalize()
      const q = o.clone()
      for (let i = 0; i < 600 && inside(q, cs); i++) q.add(d.clone().multiplyScalar(0.05))
      return { wall: q.sub(d.clone().multiplyScalar(0.08)), face: d.clone().negate() }
    }
    const spots: { from: [number, number]; dir: [number, number]; house: number }[] = [
      { from: [0.27, 0.11], dir: [0.45, -0.9], house: 0 }, // fundo do pavilhão do acento
      { from: [0.195, 0.45], dir: [-1, 0], house: 1 }, // haste: esquerda, direita, alternando
      { from: [0.195, 0.55], dir: [1, 0], house: 2 },
      { from: [0.195, 0.68], dir: [-1, 0], house: 3 },
      { from: [0.195, 0.8], dir: [1, 0], house: 4 },
      { from: [0.64, 0.76], dir: [-0.78, -0.62], house: 5 }, // diagonal do z, uma de cada lado
      { from: [0.72, 0.66], dir: [0.78, 0.62], house: 6 },
    ]
    let done = 0
    for (const sp of spots) {
      const tex = await this.loader.loadAsync(images[sp.house])
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      onProgress(++done / spots.length)
      const img = tex.image as HTMLImageElement
      const ar = img.width / img.height
      const h = 1.9
      const wd = Math.min(3.2, h * ar)
      const art = new THREE.Group()
      const frame = new THREE.Mesh(new THREE.BoxGeometry(wd + 0.12, h + 0.12, 0.06), new THREE.MeshStandardMaterial({ color: '#1d1915', roughness: 0.6 }))
      frame.castShadow = true
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(wd, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }))
      pic.position.z = 0.035
      art.add(frame, pic)
      const { wall, face } = hit(sp.from, sp.dir)
      art.position.set(wall.x, 1.9, wall.y)
      art.lookAt(wall.x + face.x, 1.9, wall.y + face.y)
      this.scene.add(art)
      this.arts.push({ mesh: art, house: sp.house, pos: art.position.clone() })
    }
    const A = (i: number) => this.arts[i].pos.clone()

    // percurso da câmera (alturas em metros) e do olhar
    const E = 1.7
    const pt = (nx: number, ny: number, y: number) => {
      const v = P(nx, ny)
      return new THREE.Vector3(v.x, y, v.y)
    }
    this.path = new THREE.CatmullRomCurve3(
      [
        pt(0.5, 1.25, 66), // aérea: a planta inteira
        pt(0.42, 0.85, 36),
        pt(0.24, 0.3, 10),
        pt(0.215, 0.17, E), // pousa na ponta do acento, de frente para a primeira obra
        pt(0.2, 0.3, E), // entra na barra do Í
        pt(0.195, 0.45, E),
        pt(0.195, 0.58, E),
        pt(0.195, 0.7, E),
        pt(0.2, 0.86, E + 0.3),
        pt(0.3, 0.96, 9), // sobe por cima dos muros e cruza o pátio
        pt(0.47, 0.98, 12),
        pt(0.56, 0.9, 4),
        pt(0.6, 0.83, E), // desce na base da diagonal do z
        pt(0.67, 0.73, E),
        pt(0.74, 0.63, E + 0.4),
        pt(0.8, 0.45, 16), // sobe e recua para a aérea final
        pt(0.62, 1.35, 72),
      ],
      false,
      'centripetal',
    )
    this.look = new THREE.CatmullRomCurve3(
      [
        pt(0.5, 0.5, 0),
        pt(0.38, 0.42, 0),
        pt(0.26, 0.12, 1.4),
        A(0),
        A(1),
        A(2),
        A(3),
        A(4),
        pt(0.3, 1.0, 0),
        pt(0.55, 0.9, 0),
        pt(0.65, 0.78, 0.5),
        A(5),
        A(6),
        pt(0.85, 0.5, 1.4),
        pt(0.65, 0.5, 0),
        pt(0.5, 0.5, 0),
        pt(0.5, 0.5, 0),
      ],
      false,
      'centripetal',
    )

    // acabamento: oclusão ambiente (cantos e encontros de parede ganham sombra)
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    const ao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight)
    ao.blendIntensity = 0.85
    this.composer.addPass(ao)
    this.composer.addPass(new OutputPass())
    this.resize()
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.composer?.setSize(w, h)
  }

  // a obra para onde a câmera está olhando (para o texto)
  private lookAt = new THREE.Vector3()
  nearest() {
    let best = -1
    let bd = 3
    for (const a of this.arts) {
      if (a.pos.distanceTo(this.camera.position) > 12) continue
      const d = a.pos.distanceTo(this.lookAt)
      if (d < bd) {
        bd = d
        best = a.house
      }
    }
    return best
  }

  render(mx: number, my: number, t: number) {
    this.riseU.value = this.rise.v
    const u = THREE.MathUtils.clamp(this.progress, 0, 1)
    const p = this.path.getPointAt(u)
    const l = this.look.getPointAt(u)
    this.lookAt.copy(l)
    this.camera.position.copy(p)
    this.camera.lookAt(l)
    // o cursor vira um pouco a cabeça
    this.camera.rotateY(-mx * 0.12)
    this.camera.rotateX(-my * 0.06)
    this.camera.position.y += Math.sin(t * 0.9) * 0.015
    this.composer.render()
  }
}
