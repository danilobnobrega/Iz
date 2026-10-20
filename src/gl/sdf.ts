import * as THREE from 'three'

// Campo de distância com sinal (SDF) do wordmark, gerado em canvas.
// Valores em unidades de "altura do glifo" (1 = altura da textura), positivo fora, negativo dentro.
// Codificado em 8 bits: 0.5 = borda, SPREAD = distância máxima representada.

export const SPREAD = 0.22

export type GlyphSDF = {
  texture: THREE.DataTexture
  aspect: number // largura / altura da textura
  anchor: THREE.Vector2 // ponto mais "fundo" da haste do Í, em unidades de glifo (centro = 0,0)
}

const INF = 1e20

// Felzenszwalb & Huttenlocher, transformada de distância 1D ao quadrado
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

function edt2d(grid: Float64Array, w: number, h: number) {
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

export function createGlyphSDF(text: string, family: string, weight: number, W = 1280, H = 960): GlyphSDF {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'

  // ajusta o tamanho do texto pra caber com folga pro SPREAD
  let size = H * 0.78
  ctx.font = `${weight} ${size}px ${family}`
  let m = ctx.measureText(text)
  const maxW = W * 0.86
  const maxH = H * 0.74
  const fit = Math.min(maxW / m.width, maxH / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent))
  size *= fit
  ctx.font = `${weight} ${size}px ${family}`
  m = ctx.measureText(text)
  const textH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  const x0 = (W - m.width) / 2
  const y0 = (H - textH) / 2 + m.actualBoundingBoxAscent
  ctx.fillText(text, x0, y0)

  const img = ctx.getImageData(0, 0, W, H).data
  const outside = new Float64Array(W * H)
  const inside = new Float64Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const a = img[i * 4] / 255
    outside[i] = a > 0.5 ? 0 : INF
    inside[i] = a > 0.5 ? INF : 0
  }
  edt2d(outside, W, H)
  edt2d(inside, W, H)

  const data = new Uint8Array(W * H)
  const firstW = ctx.measureText(text[0]).width
  let best = -1
  let bx = 0
  let by = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const dist = (outside[i] - inside[i]) / H // unidades de glifo
      const enc = 0.5 + dist / (2 * SPREAD)
      // textura com origem embaixo (flipY manual)
      data[(H - 1 - y) * W + x] = Math.max(0, Math.min(255, Math.round(enc * 255)))
      // ponto mais interno do primeiro caractere (haste do Í)
      if (x < x0 + firstW && inside[i] > best) {
        best = inside[i]
        bx = x
        by = y
      }
    }
  }

  const texture = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true

  return {
    texture,
    aspect: W / H,
    anchor: new THREE.Vector2((bx - W / 2) / H, (H / 2 - by) / H),
  }
}
