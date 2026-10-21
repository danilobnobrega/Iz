import * as THREE from 'three'

// Fundo opaco pintado com luzes desfocadas. Precisa ser opaco para o vidro (transmissão) refratar
// alguma coisa: pontos transparentes não entram na passada de transmissão do three.

export function backdrop(colors: string[], count = 120, base = '#120d0a') {
  const W = 2048, H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  x.fillStyle = '#060504'
  x.fillRect(0, 0, W, H)
  // um brilho quente no meio (o salão atrás), para o vidro ter o que refratar
  const g = x.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, W * 0.45)
  g.addColorStop(0, base)
  g.addColorStop(1, '#060504')
  x.fillStyle = g
  x.fillRect(0, 0, W, H)
  x.globalCompositeOperation = 'lighter'
  x.filter = 'blur(3px)'
  for (let i = 0; i < count; i++) {
    const r = 8 + Math.pow(Math.random(), 3) * 34
    const px = Math.random() * W, py = H * 0.15 + Math.random() * H * 0.6
    const col = colors[Math.floor(Math.random() * colors.length)]
    const grd = x.createRadialGradient(px, py, r * 0.75, px, py, r)
    grd.addColorStop(0, col + '22')
    grd.addColorStop(0.9, col + '40')
    grd.addColorStop(1, col + '00')
    x.fillStyle = grd
    x.beginPath()
    x.arc(px, py, r, 0, Math.PI * 2)
    x.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ map: t }))
  m.userData.tex = t
  return m
}
