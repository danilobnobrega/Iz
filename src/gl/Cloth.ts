import * as THREE from 'three'

// Toalha de linho simulada (Verlet com restrições de distância), deitada sobre a mesa
// (o plano z = 0, visto de cima). A ponta pode ser puxada; o cursor levanta o pano.
// Unidades em pixels de tela: a câmera é posicionada pra que z = 0 bata com o DOM.

export class Cloth {
  cols: number
  rows: number
  p: Float32Array
  prev: Float32Array
  rest: Float32Array
  pinned: Uint8Array
  pinTarget: Float32Array
  cons: Int32Array
  len: Float32Array
  geo: THREE.BufferGeometry
  w: number
  h: number

  constructor(w: number, h: number, cols = 66) {
    this.w = w
    this.h = h
    this.cols = cols
    this.rows = Math.max(12, Math.round((cols * h) / w))
    const n = this.cols * this.rows
    this.p = new Float32Array(n * 3)
    this.prev = new Float32Array(n * 3)
    this.rest = new Float32Array(n * 3)
    this.pinned = new Uint8Array(n)
    this.pinTarget = new Float32Array(n * 3)
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const i = (r * this.cols + c) * 3
        this.rest[i] = -w / 2 + (c / (this.cols - 1)) * w
        this.rest[i + 1] = h / 2 - (r / (this.rows - 1)) * h
        this.rest[i + 2] = 0
      }
    this.p.set(this.rest)
    this.prev.set(this.rest)

    // restrições: estrutura, cisalhamento e flexão (pula um)
    const list: number[] = []
    const at = (r: number, c: number) => r * this.cols + c
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (c + 1 < this.cols) list.push(at(r, c), at(r, c + 1))
        if (r + 1 < this.rows) list.push(at(r, c), at(r + 1, c))
        if (c + 1 < this.cols && r + 1 < this.rows) list.push(at(r, c), at(r + 1, c + 1), at(r, c + 1), at(r + 1, c))
        if (c + 2 < this.cols) list.push(at(r, c), at(r, c + 2))
        if (r + 2 < this.rows) list.push(at(r, c), at(r + 2, c))
      }
    this.cons = new Int32Array(list)
    this.len = new Float32Array(list.length / 2)
    for (let k = 0; k < this.len.length; k++) {
      const a = this.cons[k * 2] * 3
      const b = this.cons[k * 2 + 1] * 3
      this.len[k] = Math.hypot(this.rest[a] - this.rest[b], this.rest[a + 1] - this.rest[b + 1])
    }

    // malha
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage))
    const uv = new Float32Array(n * 2)
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        uv[(r * this.cols + c) * 2] = c / (this.cols - 1)
        uv[(r * this.cols + c) * 2 + 1] = 1 - r / (this.rows - 1)
      }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    const idx: number[] = []
    for (let r = 0; r < this.rows - 1; r++)
      for (let c = 0; c < this.cols - 1; c++) {
        const a = at(r, c)
        const b = at(r, c + 1)
        const d = at(r + 1, c)
        const e = at(r + 1, c + 1)
        idx.push(a, d, b, b, d, e)
      }
    this.geo.setIndex(idx)
    this.geo.computeVertexNormals()
  }

  // um passo fixo de simulação
  step(dt: number, opts: { lift: { x: number; y: number; r: number; h: number } | null; restPull: number }) {
    const n = this.cols * this.rows
    const { p, prev, rest, pinned, pinTarget } = this
    const g = 2600 * dt * dt
    for (let i = 0; i < n; i++) {
      const k = i * 3
      if (pinned[i]) {
        prev[k] = p[k]
        prev[k + 1] = p[k + 1]
        prev[k + 2] = p[k + 2]
        p[k] = pinTarget[k]
        p[k + 1] = pinTarget[k + 1]
        p[k + 2] = pinTarget[k + 2]
        continue
      }
      const vx = (p[k] - prev[k]) * 0.985
      const vy = (p[k + 1] - prev[k + 1]) * 0.985
      const vz = (p[k + 2] - prev[k + 2]) * 0.97
      prev[k] = p[k]
      prev[k + 1] = p[k + 1]
      prev[k + 2] = p[k + 2]
      p[k] += vx
      p[k + 1] += vy
      p[k + 2] += vz - g
      // brisa do cursor: o pano sobe numa bolha macia
      if (opts.lift) {
        const dx = p[k] - opts.lift.x
        const dy = p[k + 1] - opts.lift.y
        const d2 = dx * dx + dy * dy
        const r2 = opts.lift.r * opts.lift.r
        if (d2 < r2) {
          const f = 1 - Math.sqrt(d2) / opts.lift.r
          const target = opts.lift.h * f * f * (3 - 2 * f)
          if (p[k + 2] < target) p[k + 2] += (target - p[k + 2]) * 0.22
        }
      }
      if (opts.restPull > 0) {
        p[k] += (rest[k] - p[k]) * opts.restPull
        p[k + 1] += (rest[k + 1] - p[k + 1]) * opts.restPull
        p[k + 2] += (rest[k + 2] - p[k + 2]) * opts.restPull
      }
    }

    // restrições
    const { cons, len } = this
    for (let it = 0; it < 7; it++) {
      for (let c = 0; c < len.length; c++) {
        const ia = cons[c * 2]
        const ib = cons[c * 2 + 1]
        const a = ia * 3
        const b = ib * 3
        const dx = p[b] - p[a]
        const dy = p[b + 1] - p[a + 1]
        const dz = p[b + 2] - p[a + 2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
        const diff = (d - len[c]) / d
        const wa = pinned[ia] ? 0 : 1
        const wb = pinned[ib] ? 0 : 1
        const ws = wa + wb
        if (!ws) continue
        const s = diff / ws
        p[a] += dx * s * wa
        p[a + 1] += dy * s * wa
        p[a + 2] += dz * s * wa
        p[b] -= dx * s * wb
        p[b + 1] -= dy * s * wb
        p[b + 2] -= dz * s * wb
      }
      // a mesa: nada passa por baixo, e o pano tem atrito com ela
      for (let i = 0; i < n; i++) {
        const k = i * 3
        if (p[k + 2] < 0) {
          p[k + 2] = 0
          prev[k] = p[k] - (p[k] - prev[k]) * 0.82
          prev[k + 1] = p[k + 1] - (p[k + 1] - prev[k + 1]) * 0.82
        }
      }
    }
  }

  // levemente acima da mesa pra não brigar com o z-buffer
  sync() {
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    this.geo.computeVertexNormals()
  }
}

// ---------- linho e bordado ----------

export function linenTextures(W: number, H: number, mono: string, line: string) {
  const make = () => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    return [c, c.getContext('2d')!] as const
  }
  const [col, cx] = make()
  const [bump, bx] = make()
  const rnd = (() => {
    let s = 7
    return () => ((s = (s * 16807) % 2147483647) / 2147483647)
  })()

  // base
  cx.fillStyle = '#efe9dd'
  cx.fillRect(0, 0, W, H)
  bx.fillStyle = '#7a7a7a'
  bx.fillRect(0, 0, W, H)

  // trama: fios horizontais e verticais com espessura irregular (o "slub" do linho)
  const pitch = Math.max(2.2, W / 900)
  for (let pass = 0; pass < 2; pass++) {
    const horiz = pass === 0
    const total = horiz ? H : W
    for (let t = 0; t < total; t += pitch) {
      const wdt = pitch * (0.45 + rnd() * 0.5)
      const tone = rnd()
      cx.fillStyle = `rgba(${horiz ? '120,104,82' : '255,252,244'},${0.03 + tone * 0.05})`
      bx.fillStyle = `rgba(255,255,255,${0.18 + tone * 0.22})`
      if (horiz) {
        cx.fillRect(0, t, W, wdt)
        bx.fillRect(0, t, W, wdt)
      } else {
        cx.fillRect(t, 0, wdt, H)
        bx.fillRect(t, 0, wdt, H)
      }
      // nós ocasionais
      if (rnd() > 0.965) {
        const at = rnd() * (horiz ? W : H)
        const ln = 10 + rnd() * 40
        cx.fillStyle = 'rgba(150,132,104,0.06)'
        bx.fillStyle = 'rgba(255,255,255,0.35)'
        if (horiz) {
          cx.fillRect(at, t, ln, wdt * 1.6)
          bx.fillRect(at, t, ln, wdt * 1.6)
        } else {
          cx.fillRect(t, at, wdt * 1.6, ln)
          bx.fillRect(t, at, wdt * 1.6, ln)
        }
      }
    }
  }

  // bainha: barra dupla a 4% da borda, com ponto de bainha aberta
  const m = Math.round(Math.min(W, H) * 0.045)
  cx.strokeStyle = 'rgba(94,31,25,0.5)'
  cx.lineWidth = Math.max(1, W / 1400)
  bx.strokeStyle = 'rgba(255,255,255,0.7)'
  bx.lineWidth = cx.lineWidth * 2
  cx.setLineDash([W / 400, W / 600])
  bx.setLineDash([W / 400, W / 600])
  for (const o of [m, m + W / 260]) {
    cx.strokeRect(o, o, W - o * 2, H - o * 2)
    bx.strokeRect(o, o, W - o * 2, H - o * 2)
  }
  cx.setLineDash([])
  bx.setLineDash([])

  // bordado: ponto cheio em diagonal, recortado pela forma das letras
  const embroider = (text: string, font: string, x: number, y: number, thread: string, stitch: number) => {
    const [mask, mx] = make()
    mx.font = font
    mx.textAlign = 'center'
    mx.textBaseline = 'alphabetic'
    mx.fillStyle = '#fff'
    mx.fillText(text, x, y)
    const [st, sx] = make()
    const step = stitch
    sx.lineCap = 'round'
    for (let k = -H; k < W + H; k += step) {
      sx.strokeStyle = thread
      sx.lineWidth = step * 0.9
      sx.beginPath()
      sx.moveTo(k, 0)
      sx.lineTo(k + H * 0.55, H)
      sx.stroke()
      sx.strokeStyle = 'rgba(255,255,255,0.18)'
      sx.lineWidth = step * 0.25
      sx.beginPath()
      sx.moveTo(k - step * 0.2, 0)
      sx.lineTo(k + H * 0.55 - step * 0.2, H)
      sx.stroke()
    }
    sx.globalCompositeOperation = 'destination-in'
    sx.drawImage(mask, 0, 0)
    // sombra do relevo do bordado sobre o linho
    cx.save()
    cx.shadowColor = 'rgba(60,40,20,0.35)'
    cx.shadowBlur = stitch * 1.5
    cx.shadowOffsetY = stitch * 0.6
    cx.drawImage(st, 0, 0)
    cx.restore()
    // relevo
    const [sb, sbx] = make()
    sbx.drawImage(mask, 0, 0)
    bx.save()
    bx.filter = `blur(${stitch * 0.6}px)`
    bx.drawImage(sb, 0, 0)
    bx.restore()
    bx.globalAlpha = 0.6
    bx.drawImage(st, 0, 0)
    bx.globalAlpha = 1
  }
  const mh = Math.round(Math.min(W, H) * 0.26)
  embroider(mono, `640 ${mh}px 'Fraunces Variable', Georgia, serif`, W / 2, H * 0.56, '#5e1f19', Math.max(2, mh / 90))
  const lh = Math.round(Math.min(W, H) * 0.022)
  embroider(line, `500 ${lh}px 'Inter Tight Variable', system-ui, sans-serif`, W / 2, H * 0.56 + lh * 3.2, '#5e1f19', Math.max(1.2, lh / 16))

  const map = new THREE.CanvasTexture(col)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const bumpMap = new THREE.CanvasTexture(bump)
  bumpMap.anisotropy = 8
  return { map, bumpMap }
}

// ---------- palco ----------

export class TableStage {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(22, 1, 10, 20000)
  cloth!: Cloth
  mesh!: THREE.Mesh
  mat: THREE.MeshPhysicalMaterial
  w = 1
  h = 1

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    const key = new THREE.DirectionalLight('#fff3e2', 2.4)
    key.position.set(-0.55, 0.7, 1).multiplyScalar(1000)
    const fill = new THREE.HemisphereLight('#ffffff', '#b8a98e', 1.1)
    this.scene.add(key, fill)
    this.mat = new THREE.MeshPhysicalMaterial({
      roughness: 0.86,
      sheen: 1,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color('#fffaf0'),
      side: THREE.DoubleSide,
      bumpScale: 1.4,
    })
  }

  build(mono: string, line: string) {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.w, this.h, false)
    const fov = (this.camera.fov * Math.PI) / 180
    this.camera.aspect = this.w / this.h
    this.camera.position.set(0, 0, this.h / 2 / Math.tan(fov / 2))
    this.camera.updateProjectionMatrix()
    // a toalha sobra um pouco além da tela
    const cw = this.w * 1.08
    const ch = this.h * 1.08
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.cloth.geo.dispose()
    }
    this.cloth = new Cloth(cw, ch, this.w < 861 ? 34 : 64)
    const texW = 2048
    const { map, bumpMap } = linenTextures(texW, Math.round((texW * ch) / cw), mono, line)
    this.mat.map?.dispose()
    this.mat.bumpMap?.dispose()
    this.mat.map = map
    this.mat.bumpMap = bumpMap
    this.mat.needsUpdate = true
    this.mesh = new THREE.Mesh(this.cloth.geo, this.mat)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
