import * as THREE from 'three'

// Arte impressa das páginas do livro, desenhada em canvas: papel com fibra, tipografia,
// fotos impressas com margem. Cada função devolve uma textura pronta.

export const PAPER = '#efe7d8'
export const INK = '#1d1915'
export const ACC = '#b8462e' // vermelho de impressão
const SERIF = '"Fraunces Variable", Georgia, serif'
const ITAL = '"Instrument Serif", Georgia, serif'
const MONO = '"JetBrains Mono Variable", monospace'

export const PW = 1200
export const PH = 1600

function paper(x: CanvasRenderingContext2D, w: number, h: number, base = PAPER) {
  x.fillStyle = base
  x.fillRect(0, 0, w, h)
  // fibra: pontos e riscos muito leves
  const img = x.getImageData(0, 0, w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  x.putImageData(img, 0, 0)
  x.globalAlpha = 0.05
  x.strokeStyle = '#7a6a55'
  for (let i = 0; i < 120; i++) {
    x.beginPath()
    const px = Math.random() * w, py = Math.random() * h
    x.moveTo(px, py)
    x.lineTo(px + (Math.random() - 0.5) * 30, py + (Math.random() - 0.5) * 30)
    x.stroke()
  }
  x.globalAlpha = 1
}

export function canvas(w = PW, h = PH) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, x: c.getContext('2d')! }
}

export function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function folio(x: CanvasRenderingContext2D, n: string, right: boolean) {
  x.fillStyle = INK
  x.font = `500 26px ${MONO}`
  x.textAlign = right ? 'right' : 'left'
  x.fillText(n, right ? PW - 90 : 90, PH - 80)
}

function wrap(x: CanvasRenderingContext2D, text: string, left: number, top: number, maxW: number, lh: number) {
  const words = text.split(' ')
  let line = ''
  let y = top
  for (const w of words) {
    const t = line ? line + ' ' + w : w
    if (x.measureText(t).width > maxW && line) {
      x.fillText(line, left, y)
      line = w
      y += lh
    } else line = t
  }
  x.fillText(line, left, y)
  return y
}

// página de texto (esquerda)
export function textPage(kicker: string, title: string, body: string, n: string) {
  const { c, x } = canvas()
  paper(x, PW, PH)
  x.fillStyle = ACC
  x.font = `500 30px ${MONO}`
  x.textAlign = 'left'
  x.fillText(kicker.toUpperCase(), 110, 210)
  x.fillStyle = INK
  x.font = `300 96px ${SERIF}`
  const y = wrap(x, title, 110, 360, PW - 220, 104)
  x.font = `italic 46px ${ITAL}`
  wrap(x, body, 110, y + 130, PW - 260, 60)
  folio(x, n, false)
  return tex(c)
}

// página lisa com fólio (direita, onde vai o mecanismo)
export function plainPage(n: string, note = '') {
  const { c, x } = canvas()
  paper(x, PW, PH)
  if (note) {
    x.fillStyle = ACC
    x.font = `500 26px ${MONO}`
    x.textAlign = 'left'
    x.fillText(note.toUpperCase(), 90, 120)
  }
  folio(x, n, true)
  return tex(c)
}

export function coverTex() {
  const { c, x } = canvas()
  // tecido verde-escuro com trama
  x.fillStyle = '#1f3a32'
  x.fillRect(0, 0, PW, PH)
  for (let y = 0; y < PH; y += 3) {
    x.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.02})`
    x.fillRect(0, y, PW, 1)
  }
  for (let xx = 0; xx < PW; xx += 3) {
    x.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.03})`
    x.fillRect(xx, 0, 1, PH)
  }
  // dourado
  const g = x.createLinearGradient(0, 500, 0, 1000)
  g.addColorStop(0, '#f3d79a')
  g.addColorStop(0.5, '#b8893f')
  g.addColorStop(1, '#e7c37a')
  x.fillStyle = g
  x.textAlign = 'center'
  x.font = `400 520px ${SERIF}`
  x.fillText('Íz', PW / 2, 980)
  x.font = `500 34px ${MONO}`
  x.fillText('GRUPO ÍZ · GOIÂNIA', PW / 2, 1230)
  x.font = `italic 44px ${ITAL}`
  x.fillText('um livro de sete casas', PW / 2, 1310)
  return tex(c)
}

export function backCoverTex() {
  const { c, x } = canvas()
  x.fillStyle = '#1f3a32'
  x.fillRect(0, 0, PW, PH)
  for (let y = 0; y < PH; y += 3) {
    x.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.02})`
    x.fillRect(0, y, PW, 1)
  }
  x.fillStyle = '#d7b672'
  x.textAlign = 'center'
  x.font = `500 28px ${MONO}`
  x.fillText('PROPOSTA NÃO OFICIAL · DANILO', PW / 2, PH - 140)
  return tex(c)
}

// cartão recortado: texto ou foto com borda de papel, fundo transparente fora do recorte
export function cardText(text: string, w = 900, h = 700, size = 520, color = INK, bg = '') {
  const { c, x } = canvas(w, h)
  if (bg) {
    paper(x, w, h, bg)
  }
  x.fillStyle = color
  x.textAlign = 'center'
  x.textBaseline = 'alphabetic'
  let s = size
  x.font = `400 ${s}px ${SERIF}`
  while (x.measureText(text).width > w * 0.92) {
    s -= 8
    x.font = `400 ${s}px ${SERIF}`
  }
  x.fillText(text, w / 2, h * 0.82)
  return { t: tex(c), c }
}

export async function photoCard(src: string, w: number, h: number, caption = '') {
  const img = await loadImg(src)
  const { c, x } = canvas(w, h)
  paper(x, w, h, '#f6f0e4')
  const m = Math.round(w * 0.06)
  const ih = caption ? h - m * 2 - 70 : h - m * 2
  const iw = w - m * 2
  const r = Math.max(iw / img.width, ih / img.height)
  const sw = iw / r, sh = ih / r
  x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, m, m, iw, ih)
  if (caption) {
    x.fillStyle = INK
    x.font = `400 ${Math.round(w * 0.075)}px ${SERIF}`
    x.textAlign = 'center'
    x.fillText(caption, w / 2, h - m - 14)
  }
  return tex(c)
}

export function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = src
  })
}

// camadas do livro-túnel: a foto recortada por faixas de profundidade
export async function depthLayers(name: string, cuts: number[]) {
  const base = import.meta.env.BASE_URL
  const [img, dep] = await Promise.all([loadImg(`${base}img/${name}.webp`), loadImg(`${base}depth/${name}.png`)])
  const W = 1000
  const H = Math.round((W * img.height) / img.width)
  const a = canvas(W, H)
  a.x.drawImage(img, 0, 0, W, H)
  const ip = a.x.getImageData(0, 0, W, H)
  const b = canvas(W, H)
  b.x.drawImage(dep, 0, 0, W, H)
  const dp = b.x.getImageData(0, 0, W, H).data
  return cuts.map((lo, k) => {
    const hi = k === 0 ? 2 : cuts[k - 1]
    const L = canvas(W, H)
    const out = L.x.createImageData(W, H)
    for (let i = 0; i < W * H; i++) {
      const d = dp[i * 4] / 255
      if (d >= lo && d < hi) {
        out.data.set([ip.data[i * 4], ip.data[i * 4 + 1], ip.data[i * 4 + 2], 255], i * 4)
      }
    }
    L.x.putImageData(out, 0, 0)
    // borda de papel cortado: contorno claro em volta do recorte
    L.x.globalCompositeOperation = 'destination-over'
    L.x.shadowColor = '#f6f0e4'
    L.x.shadowBlur = 0
    for (const [ox, oy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3], [3, -3], [-3, 3]]) L.x.drawImage(L.c, ox, oy)
    // moldura de papel em cada camada, como um teatrinho: a janela fica menor nas camadas da frente
    L.x.globalCompositeOperation = 'source-over'
    const b = Math.round(W * (0.02 + (cuts.length - 1 - k) * 0.016))
    const tone = ['#efe5d2', '#e8dcc6', '#e2d4bb', '#dccdb2'][k % 4]
    L.x.fillStyle = tone
    L.x.fillRect(0, 0, W, b)
    L.x.fillRect(0, H - b, W, b)
    L.x.fillRect(0, 0, b, H)
    L.x.fillRect(W - b, 0, b, H)
    L.x.strokeStyle = 'rgba(60,40,20,0.35)'
    L.x.lineWidth = 3
    L.x.strokeRect(b, b, W - b * 2, H - b * 2)
    return { t: tex(L.c), aspect: W / H }
  })
}

// disco do volvelle: nomes em volta, como um mostrador
export function wheelTex(items: [string, string][]) {
  const S = 1600
  const { c, x } = canvas(S, S)
  x.translate(S / 2, S / 2)
  x.beginPath()
  x.arc(0, 0, S / 2 - 4, 0, Math.PI * 2)
  x.clip()
  x.fillStyle = '#e8dcc6'
  x.fillRect(-S / 2, -S / 2, S, S)
  x.strokeStyle = INK
  x.lineWidth = 3
  x.beginPath()
  x.arc(0, 0, S / 2 - 30, 0, Math.PI * 2)
  x.stroke()
  const n = items.length
  items.forEach(([name, place], i) => {
    x.save()
    x.rotate((i / n) * Math.PI * 2)
    x.fillStyle = i === n - 1 ? ACC : INK
    x.textAlign = 'center'
    x.font = `400 ${name.length > 12 ? 60 : 84}px ${SERIF}`
    x.fillText(name, 0, -S * 0.33)
    x.font = `500 30px ${MONO}`
    x.fillText(place.toUpperCase(), 0, -S * 0.28)
    x.restore()
    x.save()
    x.rotate(((i + 0.5) / n) * Math.PI * 2)
    x.fillStyle = INK
    x.fillRect(-1, -S / 2 + 30, 2, 60)
    x.restore()
  })
  x.fillStyle = ACC
  x.beginPath()
  x.arc(0, 0, 40, 0, Math.PI * 2)
  x.fill()
  return tex(c)
}

// página com janela: o nome aparece por um recorte (o resto da página cobre o disco)
export function windowPage(n: string) {
  const { c, x } = canvas()
  paper(x, PW, PH)
  x.fillStyle = INK
  x.font = `500 26px ${MONO}`
  x.textAlign = 'center'
  x.fillText('GIRE O DISCO', PW / 2, 1290)
  // janela: retângulo transparente
  x.clearRect(PW / 2 - 330, 300, 660, 260)
  x.strokeStyle = INK
  x.lineWidth = 3
  x.strokeRect(PW / 2 - 330, 300, 660, 260)
  folio(x, n, true)
  return tex(c)
}
