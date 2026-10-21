import { loadImage, rng } from './util'
import { FONTS } from './type'
import type { House } from './houses'

// Gravação a laser dentro do vidro (subsurface laser engraving): a foto vira uma nuvem de
// microfraturas. A densidade de pontos segue o brilho da foto (mais luz, mais pontos), as bordas
// ganham reforço para os detalhes não sumirem, e a profundidade vem do mapa de profundidade
// gerado para cada foto, então o prato tem relevo de verdade dentro do bloco.

export type Cloud = { pos: Float32Array; rnd: Float32Array; lum: Float32Array; count: number; w: number; h: number }

const BASE = import.meta.env.BASE_URL

function sampleCanvas(src: CanvasImageSource, sw: number, sh: number, crop: [number, number, number, number], W: number) {
  const cw = (crop[2] - crop[0]) * sw
  const ch = (crop[3] - crop[1]) * sh
  const H = Math.round((W * ch) / cw)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(src, crop[0] * sw, crop[1] * sh, cw, ch, 0, 0, W, H)
  return { data: x.getImageData(0, 0, W, H).data, W, H }
}

export async function engrave(h: House, slot: { w: number; h: number; d: number }, count: number, seed = 1): Promise<Cloud> {
  const R = rng(seed)
  const W = 300
  let lum: Float32Array
  let dep: Float32Array
  let IW = W
  let IH = W
  if (h.engrave.img) {
    const crop = h.engrave.crop ?? [0, 0, 1, 1]
    const [img, dimg] = await Promise.all([loadImage(`${BASE}img/${h.engrave.img}.webp`), loadImage(`${BASE}depth/${h.engrave.img}.png`)])
    const a = sampleCanvas(img, img.naturalWidth, img.naturalHeight, crop, W)
    const b = sampleCanvas(dimg, dimg.naturalWidth, dimg.naturalHeight, crop, W)
    IW = a.W
    IH = a.H
    lum = new Float32Array(IW * IH)
    dep = new Float32Array(IW * IH)
    let dmin = 1, dmax = 0
    for (let i = 0; i < IW * IH; i++) {
      const r = a.data[i * 4] / 255, g = a.data[i * 4 + 1] / 255, bl = a.data[i * 4 + 2] / 255
      lum[i] = Math.pow(0.2126 * r + 0.7152 * g + 0.0722 * bl, 1.15)
      dep[i] = b.data[i * 4] / 255
      dmin = Math.min(dmin, dep[i])
      dmax = Math.max(dmax, dep[i])
    }
    for (let i = 0; i < dep.length; i++) dep[i] = (dep[i] - dmin) / Math.max(1e-3, dmax - dmin)
  } else {
    // gravação tipográfica
    const c = document.createElement('canvas')
    IW = 300
    IH = 170
    c.width = IW
    c.height = IH
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.fillStyle = '#000'
    x.fillRect(0, 0, IW, IH)
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.font = `120px ${FONTS.serif}`
    x.fillText(h.engrave.text ?? h.name, IW / 2, IH / 2 + 6)
    const d = x.getImageData(0, 0, IW, IH).data
    lum = new Float32Array(IW * IH)
    dep = new Float32Array(IW * IH)
    for (let i = 0; i < IW * IH; i++) {
      lum[i] = d[i * 4] / 255
      dep[i] = R()
    }
  }
  // borda: gradiente do brilho reforça contornos
  const prob = new Float32Array(IW * IH)
  let pmax = 0
  for (let y = 1; y < IH - 1; y++)
    for (let x = 1; x < IW - 1; x++) {
      const i = y * IW + x
      const gx = lum[i + 1] - lum[i - 1]
      const gy = lum[i + IW] - lum[i - IW]
      const l = Math.min(1, Math.max(0, (lum[i] - 0.18) / 0.75))
      let v = Math.pow(l, 1.6) * 0.85 + Math.min(1, Math.hypot(gx, gy) * 3) * 0.5
      // borda que se dissolve: a gravação não termina num retângulo
      const ex = Math.min(x, IW - 1 - x) / (IW * 0.14)
      const ey = Math.min(y, IH - 1 - y) / (IH * 0.14)
      const edge = Math.min(1, ex) * Math.min(1, ey)
      v *= edge * edge * (3 - 2 * edge)
      prob[i] = v
      pmax = Math.max(pmax, v)
    }
  const s = Math.min(slot.w / IW, slot.h / IH)
  const pos = new Float32Array(count * 3)
  const rnd = new Float32Array(count)
  const lm = new Float32Array(count)
  let n = 0
  let guard = 0
  while (n < count && guard++ < count * 60) {
    const x = Math.floor(R() * IW)
    const y = Math.floor(R() * IH)
    const i = y * IW + x
    if (R() * pmax > prob[i]) continue
    const jx = x + R() - 0.5
    const jy = y + R() - 0.5
    pos[n * 3] = (jx - IW / 2) * s
    pos[n * 3 + 1] = (IH / 2 - jy) * s
    pos[n * 3 + 2] = (dep[i] - 0.5) * slot.d + (R() - 0.5) * 0.012
    rnd[n] = R()
    lm[n] = prob[i] / pmax
    n++
  }
  return { pos, rnd, lum: lm, count: n, w: IW * s, h: IH * s }
}
