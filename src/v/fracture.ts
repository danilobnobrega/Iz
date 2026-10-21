import * as THREE from 'three'
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import { Delaunay } from 'd3-delaunay'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import glyph from '../data/iz-glyph.json'
import { rng } from './util'

// Quebra o "Íz" (contornos reais da Fraunces 700) em peças de Voronoi relaxadas, cada peça
// extrudada com chanfro próprio. Tudo vira uma malha só; cada vértice sabe a que peça pertence
// e o centro dela, para o shader mover as peças uma a uma.

type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

export function glyphPolygons(width: number) {
  const sp = new THREE.ShapePath()
  for (const c of glyph.iz as Cmd[]) {
    if (c.type === 'M') sp.moveTo(c.x!, -c.y!)
    else if (c.type === 'L') sp.lineTo(c.x!, -c.y!)
    else if (c.type === 'Q') sp.quadraticCurveTo(c.x1!, -c.y1!, c.x!, -c.y!)
    else if (c.type === 'C') sp.bezierCurveTo(c.x1!, -c.y1!, c.x2!, -c.y2!, c.x!, -c.y!)
  }
  const shapes = sp.toShapes(true)
  const bb = glyph.bbox
  const cx = (bb.x1 + bb.x2) / 2
  const cy = -(bb.y1 + bb.y2) / 2
  const s = width / (bb.x2 - bb.x1)
  const tr = (v: THREE.Vector2): [number, number] => [(v.x - cx) * s, (v.y - cy) * s]
  const mp: MultiPolygon = shapes.map((sh) => {
    const pts = sh.extractPoints(10)
    const outer = pts.shape.map(tr)
    const holes = pts.holes.map((h) => h.map(tr))
    return [outer, ...holes] as Polygon
  })
  return { mp, height: (bb.y2 - bb.y1) * s, width }
}

function inside(mp: MultiPolygon, x: number, y: number) {
  let c = false
  for (const poly of mp)
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
      }
  return c
}

function ringArea(r: Ring) {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
  return Math.abs(a / 2)
}

function ringCentroid(r: Ring) {
  let x = 0, y = 0, a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]
    x += (r[j][0] + r[i][0]) * f
    y += (r[j][1] + r[i][1]) * f
    a += f
  }
  a *= 0.5
  if (Math.abs(a) < 1e-9) return [r[0][0], r[0][1]]
  return [x / (6 * a), y / (6 * a)]
}

export type Piece = { cx: number; cy: number; area: number; y01: number; x01: number; rand: number; poly: Polygon }

export function fractureIz(width = 3, depth = 0.36, cells = 150, seed = 7, input?: { mp: MultiPolygon; height: number }) {
  const { mp, height } = input ?? glyphPolygons(width)
  const R = rng(seed)
  const x0 = -width / 2 - 0.05, x1 = width / 2 + 0.05
  const y0 = -height / 2 - 0.05, y1 = height / 2 + 0.05
  let pts: [number, number][] = []
  let guard = 0
  while (pts.length < cells && guard++ < 50000) {
    const x = x0 + R() * (x1 - x0)
    const y = y0 + R() * (y1 - y0)
    if (inside(mp, x, y)) pts.push([x, y])
  }
  // relaxamento de Lloyd: peças de tamanho parecido, como blocos
  for (let it = 0; it < 3; it++) {
    const vor = Delaunay.from(pts).voronoi([x0, y0, x1, y1])
    pts = pts.map((p, i) => {
      const cell = vor.cellPolygon(i)
      if (!cell) return p
      const clipped = polygonClipping.intersection([cell as Ring], mp)
      let best: Ring | null = null
      let ba = 0
      for (const poly of clipped) {
        const a = ringArea(poly[0])
        if (a > ba) {
          ba = a
          best = poly[0]
        }
      }
      if (!best) return p
      const c = ringCentroid(best)
      return [p[0] + (c[0] - p[0]) * 0.85, p[1] + (c[1] - p[1]) * 0.85] as [number, number]
    })
  }
  const vor = Delaunay.from(pts).voronoi([x0, y0, x1, y1])
  const geos: THREE.BufferGeometry[] = []
  const pieces: Piece[] = []
  pts.forEach((_p, i) => {
    const cell = vor.cellPolygon(i)
    if (!cell) return
    const clipped = polygonClipping.intersection([cell as Ring], mp)
    for (const poly of clipped) {
      const area = ringArea(poly[0]) - poly.slice(1).reduce((s, h) => s + ringArea(h), 0)
      if (area < 0.0016) continue
      const shape = new THREE.Shape(poly[0].map(([x, y]) => new THREE.Vector2(x, y)))
      for (const h of poly.slice(1)) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      const bevel = Math.min(0.007, Math.sqrt(area) * 0.04)
      let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        curveSegments: 1,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelOffset: -bevel - 0.0022,
        bevelSegments: 2,
      })
      g.translate(0, 0, -depth / 2)
      if (g.index) g = g.toNonIndexed()
      g.deleteAttribute('uv')
      const [cx, cy] = ringCentroid(poly[0])
      const n = g.attributes.position.count
      const id = pieces.length
      g.setAttribute('aPiece', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1))
      const cen = new Float32Array(n * 3)
      for (let k = 0; k < n; k++) cen.set([cx, cy, 0], k * 3)
      g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3))
      g.clearGroups()
      geos.push(g)
      pieces.push({ cx, cy, area, y01: (cy - y0) / (y1 - y0), x01: (cx - x0) / (x1 - x0), rand: R(), poly })
    }
  })
  const geo = mergeGeometries(geos, false)!
  geo.computeBoundingSphere()
  return { geo, pieces, mp, width, height, depth }
}

// contorno do glifo como segmentos com distância acumulada (para desenhar o traço na abertura)
export function outlineGeometry(mp: MultiPolygon, z: number) {
  const pos: number[] = []
  const dist: number[] = []
  let total = 0
  const segs: [number[], number[], number][] = []
  for (const poly of mp)
    for (const ring of poly)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const l = Math.hypot(b[0] - a[0], b[1] - a[1])
        segs.push([a, b, total])
        total += l
      }
  for (const [a, b, d] of segs) {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    pos.push(a[0], a[1], z, b[0], b[1], z)
    dist.push(d / total, (d + l) / total)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1))
  return g
}
