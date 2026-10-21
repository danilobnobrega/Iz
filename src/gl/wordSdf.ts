import * as THREE from 'three'

// Campo de distância com sinal de várias palavras, empilhadas numa textura só (atlas vertical).
// Valor = distância até a borda da letra, em unidades da altura da célula (negativo dentro).
// Meia precisão com filtro linear: dá para amostrar entre pixels e misturar duas palavras.

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

// linha de base, como fração da altura da célula a partir do topo
export const BASE = 0.76

export type WordAtlas = { texture: THREE.DataTexture; count: number; aspect: number }

export function wordAtlas(words: string[], font: string, W = 640, H = 256, weight: number | string = 400): WordAtlas {
  const N = words.length
  const out = new Uint16Array(W * H * N)
  // desenha em 4x e tira a média de cada bloco: cobertura com precisão de subpixel,
  // sem depender do antisserrilhado do canvas (que pode não existir no modo de leitura)
  const SS = 4
  const c = document.createElement('canvas')
  c.width = W * SS
  c.height = H * SS
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.scale(SS, SS)
  words.forEach((word, k) => {
    x.fillStyle = '#000'
    x.fillRect(0, 0, W, H)
    x.imageSmoothingEnabled = true
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.textBaseline = 'alphabetic'
    let size = H * 0.78
    x.font = `${weight} ${size}px ${font}`
    while (x.measureText(word).width > W * 0.86) {
      size -= 4
      x.font = `${weight} ${size}px ${font}`
    }
    // todas as palavras na mesma linha de base: assim elas pousam no mesmo piso
    x.fillText(word, W / 2, H * BASE)
    const big = x.getImageData(0, 0, W * SS, H * SS).data
    const cov = new Float32Array(W * H)
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        let acc = 0
        for (let sy = 0; sy < SS; sy++) {
          const row = ((yy * SS + sy) * W * SS + xx * SS) * 4
          for (let sx = 0; sx < SS; sx++) acc += big[row + sx * 4]
        }
        cov[yy * W + xx] = acc / (SS * SS * 255)
      }
    const inside = new Float64Array(W * H)
    const outside = new Float64Array(W * H)
    // borda com precisão de subpixel a partir da cobertura (como o tiny-sdf): sem degraus nas paredes
    for (let i = 0; i < W * H; i++) {
      const a = cov[i]
      if (a >= 1) {
        inside[i] = 0
        outside[i] = INF
      } else if (a <= 0) {
        inside[i] = INF
        outside[i] = 0
      } else {
        const d = 0.5 - a
        inside[i] = d > 0 ? d * d : 0
        outside[i] = d < 0 ? d * d : 0
      }
    }
    edt(inside, W, H)
    edt(outside, W, H)
    for (let i = 0; i < W * H; i++) {
      // distância assinada em unidades da altura da célula
      const d = (inside[i] - outside[i]) / H
      // a textura é lida com y para cima: inverte as linhas
      const y = Math.floor(i / W)
      const xx = i % W
      const j = (k * H + (H - 1 - y)) * W + xx
      out[j] = THREE.DataUtils.toHalfFloat(Math.max(-0.5, Math.min(0.5, d)))
    }
  })
  const tex = new THREE.DataTexture(out, W, H * N, THREE.RedFormat, THREE.HalfFloatType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return { texture: tex, count: N, aspect: W / H }
}
