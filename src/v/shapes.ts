import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { House } from './houses'
import { rng } from './util'

// Cada casa num bloco de vidro de formato próprio. "slot" é o espaço interno onde a gravação cabe.

export type Shape = { geo: THREE.BufferGeometry; slot: { w: number; h: number; d: number; y: number } }

function clean(g: THREE.BufferGeometry) {
  g.deleteAttribute('uv')
  g.computeBoundingBox()
  return g
}

export function shapeFor(h: House): Shape {
  const R = rng(h.id.length * 97 + 3)
  switch (h.shape) {
    case 'block': {
      const g = new RoundedBoxGeometry(1.6, 2.05, 0.95, 6, 0.1)
      return { geo: clean(g), slot: { w: 1.28, h: 1.5, d: 0.55, y: 0 } }
    }
    case 'pebble': {
      const g = new THREE.SphereGeometry(1, 128, 80)
      const p = g.attributes.position as THREE.BufferAttribute
      const v = new THREE.Vector3()
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i)
        const k = 1 + Math.sin(v.x * 2.1 + 0.6) * 0.035 + Math.sin(v.y * 2.7 + v.z * 1.3) * 0.03
        v.multiplyScalar(k)
        v.set(v.x * 1.38, v.y * 0.95 * (1 - Math.max(0, -v.y) * 0.08), v.z * 0.64)
        p.setXYZ(i, v.x, v.y, v.z)
      }
      g.computeVertexNormals()
      return { geo: clean(g), slot: { w: 1.7, h: 1.15, d: 0.42, y: 0 } }
    }
    case 'pane': {
      const g = new RoundedBoxGeometry(2.55, 1.72, 0.4, 5, 0.07)
      return { geo: clean(g), slot: { w: 2.3, h: 1.5, d: 0.24, y: 0 } }
    }
    case 'dome': {
      const top = new THREE.SphereGeometry(1.2, 128, 64, 0, Math.PI * 2, 0, Math.PI / 2)
      const base = new THREE.CircleGeometry(1.2, 128)
      base.rotateX(Math.PI / 2)
      const g = mergeVertices(mergeGeometries([top.toNonIndexed(), base.toNonIndexed()].map((x) => (x.deleteAttribute('uv'), x)))!)
      g.computeVertexNormals()
      // borda inferior chanfrada: recalcula normais da base para baixo
      g.translate(0, -0.5, 0)
      return { geo: clean(g), slot: { w: 0.78, h: 1.0, d: 0.7, y: -0.05 } }
    }
    case 'crystal': {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i < 48; i++) {
        const a = R() * Math.PI * 2
        const y = (R() - 0.5) * 2.3
        const r = (0.95 + R() * 0.35) * (1 - Math.pow(Math.abs(y) / 1.25, 3) * 0.6)
        pts.push(new THREE.Vector3(Math.cos(a) * r * 1.05, y, Math.sin(a) * r * 0.62))
      }
      pts.push(new THREE.Vector3(0.1, 1.42, 0.05), new THREE.Vector3(-0.15, -1.3, -0.05))
      const g: THREE.BufferGeometry = new ConvexGeometry(pts)
      g.computeVertexNormals()
      return { geo: clean(g), slot: { w: 1.25, h: 0.72, d: 0.5, y: 0 } }
    }
    case 'disc': {
      const g = new THREE.CylinderGeometry(1.22, 1.22, 0.5, 40, 1)
      g.rotateX(Math.PI / 2)
      return { geo: clean(g), slot: { w: 1.62, h: 1.08, d: 0.26, y: 0 } }
    }
    case 'arch': {
      const s = new THREE.Shape()
      const w = 0.78
      s.moveTo(-w, -1.15)
      s.lineTo(w, -1.15)
      s.lineTo(w, 0.3)
      s.absarc(0, 0.3, w, 0, Math.PI, false)
      s.lineTo(-w, -1.15)
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 5, curveSegments: 64 })
      g.computeBoundingBox()
      const bb = g.boundingBox!
      g.translate(0, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2)
      g.computeVertexNormals()
      return { geo: clean(g), slot: { w: 1.2, h: 1.2, d: 0.42, y: -0.18 } }
    }
  }
}
