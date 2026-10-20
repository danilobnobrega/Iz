import * as THREE from 'three'

// Títulos em WebGL. Cada letra é um quad que amostra um atlas de campo de distância (SDF)
// gerado em tempo real a partir da própria Fraunces. O texto continua no DOM (transparente,
// selecionável); o WebGL lê a posição de cada letra no DOM e desenha por cima.
// Cada letra tem um peso de ordem (letra e linha): um único progresso faz o texto
// entrar letra a letra ou linha a linha, cada letra deslizando dentro da própria célula,
// o contorno se desenhando antes do preenchimento.

THREE.ColorManagement.enabled = false

const S = 112 // tamanho do glifo no atlas
const P = 16 // margem da célula
const SPREAD = 12 // distância máxima codificada, em px do atlas
const FAMILY = "'Fraunces Variable'"

type Style = 'n' | 'i'
type Cell = { u0: number; v0: number; u1: number; v1: number; w: number; h: number; ox: number; oy: number }

const font = (style: Style) => `${style === 'i' ? 'italic ' : ''}300 ${S}px ${FAMILY}`

// ---------- transformada de distância (Felzenszwalb) ----------
const INF = 1e20
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}
function edt(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x])
  }
}

// ---------- atlas ----------
export class GlyphAtlas {
  texture!: THREE.CanvasTexture
  cells = new Map<string, Cell>()
  ascent = 0.9 // ascendente da fonte, em fração do tamanho

  build(chars: Set<string>) {
    const mc = document.createElement('canvas').getContext('2d')!
    mc.font = font('n')
    const fm = mc.measureText('Íg')
    this.ascent = fm.fontBoundingBoxAscent / S

    // mede as células
    const items: { key: string; ch: string; style: Style; w: number; h: number; ox: number; oy: number }[] = []
    for (const key of chars) {
      const style = key[0] as Style
      const ch = key.slice(1)
      mc.font = font(style)
      const m = mc.measureText(ch)
      const left = Math.max(0, m.actualBoundingBoxLeft)
      const right = Math.max(m.width, m.actualBoundingBoxRight)
      const w = Math.ceil(left + right + P * 2)
      const oy = Math.ceil(P + S * 1.18)
      const h = Math.ceil(oy + S * 0.4 + P)
      items.push({ key, ch, style, w, h, ox: P + left, oy })
    }

    // empacota em linhas
    const W = 2048
    let x = 0
    let y = 0
    let rowH = 0
    const pos: { x: number; y: number }[] = []
    for (const it of items) {
      if (x + it.w > W) {
        x = 0
        y += rowH
        rowH = 0
      }
      pos.push({ x, y })
      x += it.w
      rowH = Math.max(rowH, it.h)
    }
    const H = Math.pow(2, Math.ceil(Math.log2(y + rowH)))

    const atlas = document.createElement('canvas')
    atlas.width = W
    atlas.height = H
    const actx = atlas.getContext('2d')!
    const out = actx.createImageData(W, H)

    const cell = document.createElement('canvas')
    const cctx = cell.getContext('2d', { willReadFrequently: true })!
    items.forEach((it, idx) => {
      cell.width = it.w
      cell.height = it.h
      cctx.clearRect(0, 0, it.w, it.h)
      cctx.fillStyle = '#fff'
      cctx.font = font(it.style)
      cctx.textBaseline = 'alphabetic'
      cctx.fillText(it.ch, it.ox, it.oy)
      const px = cctx.getImageData(0, 0, it.w, it.h).data
      const n = it.w * it.h
      const outside = new Float64Array(n)
      const inside = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const a = px[i * 4 + 3] / 255
        // meio pixel de borda: usa a cobertura pra posicionar a fronteira
        outside[i] = a >= 0.5 ? 0 : INF
        inside[i] = a >= 0.5 ? INF : 0
      }
      edt(outside, it.w, it.h)
      edt(inside, it.w, it.h)
      const p0 = pos[idx]
      for (let yy = 0; yy < it.h; yy++)
        for (let xx = 0; xx < it.w; xx++) {
          const i = yy * it.w + xx
          const d = inside[i] - outside[i] // positivo dentro
          const v = Math.max(0, Math.min(255, Math.round((0.5 + d / (2 * SPREAD)) * 255)))
          const o = ((p0.y + yy) * W + p0.x + xx) * 4
          out.data[o] = v
          out.data[o + 1] = v
          out.data[o + 2] = v
          out.data[o + 3] = 255
        }
      this.cells.set(it.key, {
        u0: p0.x / W,
        v0: p0.y / H,
        u1: (p0.x + it.w) / W,
        v1: (p0.y + it.h) / H,
        w: it.w,
        h: it.h,
        ox: it.ox,
        oy: it.oy,
      })
    })
    actx.putImageData(out, 0, 0)
    this.texture = new THREE.CanvasTexture(atlas)
    this.texture.flipY = false
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.texture.colorSpace = THREE.NoColorSpace
  }
}

// ---------- DOM ----------
// quebra o título em letras (palavras não quebram no meio) e devolve as chaves usadas
export function splitGlyphs(el: HTMLElement) {
  const keys = new Set<string>()
  const walk = (node: Node, parent: HTMLElement, italic: boolean) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        ;(child.textContent || '').split(/(\s+)/).forEach((part) => {
          if (!part) return
          if (/^\s+$/.test(part)) return void parent.appendChild(document.createTextNode(' '))
          const wd = document.createElement('span')
          wd.className = 'gwd'
          for (const ch of part) {
            const s = document.createElement('span')
            s.className = 'gch'
            s.textContent = ch
            s.dataset.k = (italic ? 'i' : 'n') + ch
            keys.add(s.dataset.k)
            wd.appendChild(s)
          }
          parent.appendChild(wd)
        })
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const elc = child as HTMLElement
        if (elc.tagName === 'BR') return void parent.appendChild(elc.cloneNode())
        const clone = elc.cloneNode(false) as HTMLElement
        parent.appendChild(clone)
        walk(elc, clone, italic || elc.tagName === 'EM' || elc.tagName === 'I')
      }
    })
  }
  const src = el.cloneNode(true)
  el.textContent = ''
  walk(src, el, false)
  return keys
}

// ---------- shader ----------
const vert = /* glsl */ `
  attribute vec4 aRect;
  attribute vec4 aGl;
  attribute vec2 aW;
  uniform vec2 uBlock;
  uniform vec2 uRes;
  uniform float uProg;
  uniform float uMargin;
  uniform float uLag;
  uniform float uMode;
  varying vec2 vLocal;
  varying vec4 vGl;
  varying float vT;
  varying float vF;
  varying vec2 vScreen;

  float prog(float w, float lag) {
    return clamp((uProg * (1.0 + uMargin + lag) - w - lag) / uMargin, 0.0, 1.0);
  }

  void main() {
    float w = mix(aW.x, aW.y, uMode);
    vT = prog(w, 0.0);
    vF = prog(w, uLag);
    vec2 c = vec2(uv.x, 1.0 - uv.y); // 0..1, de cima pra baixo
    vec2 px = uBlock + aRect.xy + c * aRect.zw;
    vScreen = px;
    vLocal = c;
    vGl = aGl;
    gl_Position = projectionMatrix * viewMatrix * vec4(px.x - uRes.x * 0.5, uRes.y * 0.5 - px.y, 0.0, 1.0);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tAtlas;
  uniform sampler2D tImg;
  uniform vec3 uColor;
  uniform float uDir;
  uniform vec2 uMouse;
  uniform float uCursorR;
  uniform float uCursor;
  uniform float uImgMix;
  uniform vec4 uImgRect;
  uniform float uImgAspect;
  uniform float uOpacity;
  varying vec2 vLocal;
  varying vec4 vGl;
  varying float vT;
  varying float vF;
  varying vec2 vScreen;

  void main() {
    float e = 1.0 - pow(1.0 - vT, 3.0);
    // a letra desliza dentro da própria célula (como uma janela)
    vec2 l = vLocal;
    l.y -= (1.0 - e) * 0.62 * uDir;
    if (l.y < 0.0 || l.y > 1.0) discard;
    vec2 a = mix(vGl.xy, vGl.zw, l);
    float sd = texture2D(tAtlas, a).r - 0.5;
    float aa = max(fwidth(sd) * 0.7, 1e-4);
    float fill = smoothstep(-aa, aa, sd);
    float lw = fwidth(sd) * 1.1;
    float outline = 1.0 - smoothstep(lw, lw + aa * 1.6, abs(sd));

    // o contorno se desenha numa varredura diagonal pela letra
    float sweep = l.x * 0.55 + (1.0 - l.y) * 0.45;
    float drawn = smoothstep(sweep - 0.08, sweep, vT * 1.12);

    // o cursor tira o preenchimento e mostra o contorno
    float c = (1.0 - smoothstep(uCursorR - 1.5, uCursorR + 1.5, distance(vScreen, uMouse))) * uCursor;

    float fillA = fill * vF * (1.0 - c);
    float lineA = outline * max(drawn * (1.0 - vF * 0.999), c);
    float alpha = max(fillA, lineA) * uOpacity;
    if (alpha < 0.002) discard;

    vec3 col = uColor;
    if (uImgMix > 0.0) {
      vec2 iu = (vScreen - uImgRect.xy) / uImgRect.zw;
      float ra = uImgRect.z / uImgRect.w;
      vec2 s = ra > uImgAspect ? vec2(1.0, uImgAspect / ra) : vec2(ra / uImgAspect, 1.0);
      iu = (iu - 0.5) * s + 0.5;
      vec3 img = texture2D(tImg, vec2(iu.x, 1.0 - iu.y)).rgb;
      col = mix(col, img, uImgMix * step(lineA, fillA));
    }
    gl_FragColor = vec4(col, alpha);
  }
`

export class TextBlock {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  prog = 0
  dir = 1
  visible = true
  private rect = new DOMRect()

  constructor(public el: HTMLElement, private atlas: GlyphAtlas, color: string, opts: { mode?: number; margin?: number; lag?: number } = {}) {
    const base = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = base.index
    geo.setAttribute('position', base.getAttribute('position'))
    geo.setAttribute('uv', base.getAttribute('uv'))
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tAtlas: { value: atlas.texture },
        tImg: { value: null },
        uBlock: { value: new THREE.Vector2() },
        uRes: { value: new THREE.Vector2() },
        uProg: { value: 0 },
        uMargin: { value: opts.margin ?? 0.35 },
        uLag: { value: opts.lag ?? 0.25 },
        uMode: { value: opts.mode ?? 0 },
        uColor: { value: new THREE.Color(color) },
        uDir: { value: 1 },
        uMouse: { value: new THREE.Vector2(-999, -999) },
        uCursorR: { value: 70 },
        uCursor: { value: 1 },
        uImgMix: { value: 0 },
        uImgRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uImgAspect: { value: 1 },
        uOpacity: { value: 1 },
      },
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
    this.layout()
  }

  // lê a posição de cada letra no DOM e monta os atributos
  layout() {
    const br = this.el.getBoundingClientRect()
    const fs = parseFloat(getComputedStyle(this.el).fontSize)
    const scale = fs / S
    const chs = Array.from(this.el.querySelectorAll<HTMLElement>('.gch'))
    const tops: number[] = []
    const rects = chs.map((c) => c.getBoundingClientRect())
    rects.forEach((r) => {
      const t = Math.round(r.top - br.top)
      if (!tops.some((x) => Math.abs(x - t) < fs * 0.3)) tops.push(t)
    })
    tops.sort((a, b) => a - b)
    const n = chs.length
    const R = new Float32Array(n * 4)
    const G = new Float32Array(n * 4)
    const Wt = new Float32Array(n * 2)
    chs.forEach((c, i) => {
      const cell = this.atlas.cells.get(c.dataset.k!)
      const r = rects[i]
      if (!cell) return
      const relX = r.left - br.left
      const relTop = r.top - br.top
      // o retângulo de um inline é a área de conteúdo: começa no topo do ascendente
      const baseline = relTop + this.atlas.ascent * fs
      R.set([relX - cell.ox * scale, baseline - cell.oy * scale, cell.w * scale, cell.h * scale], i * 4)
      G.set([cell.u0, cell.v0, cell.u1, cell.v1], i * 4)
      const line = tops.findIndex((t) => Math.abs(t - Math.round(relTop)) < fs * 0.3)
      Wt.set([n > 1 ? i / (n - 1) : 0, tops.length > 1 ? Math.max(0, line) / (tops.length - 1) : 0], i * 2)
    })
    const g = this.mesh.geometry
    g.setAttribute('aRect', new THREE.InstancedBufferAttribute(R, 4))
    g.setAttribute('aGl', new THREE.InstancedBufferAttribute(G, 4))
    g.setAttribute('aW', new THREE.InstancedBufferAttribute(Wt, 2))
    g.instanceCount = n
  }

  update(W: number, H: number, mx: number, my: number) {
    this.rect = this.el.getBoundingClientRect()
    const vis = this.rect.bottom > -200 && this.rect.top < H + 200 && this.prog > 0.0005
    this.mesh.visible = vis && this.visible
    if (!this.mesh.visible) return
    const u = this.mesh.material.uniforms
    u.uBlock.value.set(this.rect.left, this.rect.top)
    u.uRes.value.set(W, H)
    u.uProg.value = this.prog
    u.uDir.value = this.dir
    u.uMouse.value.set(mx, my)
  }
}
