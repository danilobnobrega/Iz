import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import glyph from '../data/iz-glyph.json'

// O "Íz" como objeto: geometria extrudada dos contornos reais da Fraunces 700,
// sete matérias (uma por casa) e uma transição que dissolve uma matéria na outra
// com uma borda incandescente. No fim, o objeto vira 445 (e depois 520) cópias pequenas.

type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

export function izGeometry(depth = 0.16, curve = 28, size = 2.3) {
  const sp = new THREE.ShapePath()
  for (const c of glyph.iz as Cmd[]) {
    // opentype usa y para baixo
    if (c.type === 'M') sp.moveTo(c.x!, -c.y!)
    else if (c.type === 'L') sp.lineTo(c.x!, -c.y!)
    else if (c.type === 'Q') sp.quadraticCurveTo(c.x1!, -c.y1!, c.x!, -c.y!)
    else if (c.type === 'C') sp.bezierCurveTo(c.x1!, -c.y1!, c.x2!, -c.y2!, c.x!, -c.y!)
  }
  const shapes = sp.toShapes(true)
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth,
    curveSegments: curve,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.0055,
    bevelSegments: 5,
  })
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2)
  geo.scale(size, size, size)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  return geo
}

// ---------- texturas procedurais ----------

function hash(x: number, y: number, s: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453
  return h - Math.floor(h)
}

function valueNoise(x: number, y: number, s: number, period: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const w = (t: number) => t * t * (3 - 2 * t)
  const p = (a: number) => ((a % period) + period) % period
  const a = hash(p(xi), p(yi), s)
  const b = hash(p(xi + 1), p(yi), s)
  const c = hash(p(xi), p(yi + 1), s)
  const d = hash(p(xi + 1), p(yi + 1), s)
  return a + (b - a) * w(xf) + (c - a) * w(yf) + (a - b - c + d) * w(xf) * w(yf)
}

function fbm(x: number, y: number, s: number, oct = 5, period = 8) {
  let v = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < oct; i++) {
    v += valueNoise(x * f, y * f, s + i * 13, period * f) * amp
    amp *= 0.5
    f *= 2
  }
  return v
}

function canvasTex(size: number, fn: (u: number, v: number) => [number, number, number], repeat = 2) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size)
      const i = (y * size + x) * 4
      img.data[i] = r * 255
      img.data[i + 1] = g * 255
      img.data[i + 2] = b * 255
      img.data[i + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  return t
}

// rachaduras (bordas de Voronoi) para a madeira carbonizada
function voronoiEdges(u: number, v: number, cells: number, s: number) {
  const x = u * cells
  const y = v * cells
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let f1 = 9
  let f2 = 9
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i
      const cy = yi + j
      const px = ((cx % cells) + cells) % cells
      const py = ((cy % cells) + cells) % cells
      const fx = cx + hash(px, py, s)
      const fy = cy + hash(px, py, s + 7)
      const d = Math.hypot(x - fx, y - fy)
      if (d < f1) {
        f2 = f1
        f1 = d
      } else if (d < f2) f2 = d
    }
  return f2 - f1
}

// ---------- matérias ----------

export type Kind = 'porcelana' | 'terracota' | 'espelho' | 'gelo' | 'brasa' | 'travertino' | 'laca'

export const shared = {
  uProg: { value: 0 },
  uMinY: { value: -0.5 },
  uH: { value: 1 },
  uEdge: { value: new THREE.Color('#ffb36b') },
  uTime: { value: 0 },
}

const noiseGLSL = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
`

// injeta a dissolução: side 1 = matéria que sai (some de baixo pra cima), -1 = que entra
function dissolve(mat: THREE.MeshPhysicalMaterial, side: number, key: string) {
  const uSide = { value: side }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uSide })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vObj;
        uniform float uProg; uniform float uMinY; uniform float uH; uniform vec3 uEdge; uniform float uSide; uniform float uTime;
        ${noiseGLSL}
        float disE;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float disN = (vObj.y - uMinY) / uH * 0.8 + snoise(vObj * 3.2 + vec3(0.0, uTime * 0.05, 0.0)) * 0.12 + snoise(vObj * 11.0) * 0.03;
        float th = mix(-0.2, 1.05, uProg);
        disE = disN - th;
        if (uSide > 0.0 && disE < 0.0) discard;
        if (uSide < 0.0 && disE >= 0.0) discard;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float edge = (1.0 - smoothstep(0.0, 0.05, abs(disE))) * step(0.001, uProg) * step(uProg, 0.999);
        totalEmissiveRadiance += uEdge * edge * 6.0 + uEdge * (1.0 - smoothstep(0.0, 0.16, abs(disE))) * 0.35 * step(0.001, uProg) * step(uProg, 0.999);`,
      )
  }
  mat.customProgramCacheKey = () => 'dis-' + key
  return mat
}

let texCache: Record<string, THREE.Texture> | null = null
function textures() {
  if (texCache) return texCache
  const terr = canvasTex(512, (u, v) => {
    const n = fbm(u * 8, v * 8, 1, 5, 8)
    const g = hash(Math.floor(u * 512), Math.floor(v * 512), 3) * 0.15
    return [n * 0.7 + g, n * 0.7 + g, n * 0.7 + g]
  })
  const trav = canvasTex(512, (u, v) => {
    const band = fbm(u * 2, v * 16, 4, 5, 2) // veios horizontais
    const pores = hash(Math.floor(u * 512), Math.floor(v * 512), 9) > 0.985 ? 0.0 : 1.0
    const c = 0.82 + band * 0.18
    return [c * pores, c * 0.96 * pores, c * 0.88 * pores]
  })
  const crack = canvasTex(512, (u, v) => {
    const e = voronoiEdges(u + fbm(u * 4, v * 4, 3, 3, 4) * 0.08, v, 5, 2)
    const k = Math.pow(1 - Math.min(1, e / 0.03), 2) * (0.5 + fbm(u * 6, v * 6, 8, 3, 6))
    return [k, k, k]
  }, 1.5)
  const char = canvasTex(512, (u, v) => {
    const n = fbm(u * 6, v * 24, 7, 5, 6)
    return [n, n, n]
  }, 1.5)
  const brush = canvasTex(512, (u, v) => {
    const n = fbm(u * 1, v * 64, 11, 4, 1)
    return [n, n, n]
  })
  texCache = { terr, trav, crack, char, brush }
  return texCache
}

export function makeMaterial(kind: Kind, side: number) {
  const t = textures()
  let m: THREE.MeshPhysicalMaterial
  switch (kind) {
    case 'porcelana':
      m = new THREE.MeshPhysicalMaterial({ color: '#f7f3ec', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') })
      break
    case 'terracota':
      m = new THREE.MeshPhysicalMaterial({ color: '#b5603a', roughness: 0.92, roughnessMap: t.terr, bumpMap: t.terr, bumpScale: 1.6 })
      break
    case 'espelho':
      m = new THREE.MeshPhysicalMaterial({ color: '#e9eef2', metalness: 1, roughness: 0.06, roughnessMap: t.brush, envMapIntensity: 1.4 })
      break
    case 'gelo':
      m = new THREE.MeshPhysicalMaterial({
        color: '#f3f0ff',
        roughness: 0.12,
        transmission: 1,
        thickness: 0.35,
        ior: 1.31,
        attenuationColor: new THREE.Color('#b9a8f0'),
        attenuationDistance: 0.6,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        bumpMap: t.terr,
        bumpScale: 0.25,
      })
      break
    case 'brasa':
      m = new THREE.MeshPhysicalMaterial({
        color: '#141110',
        roughness: 0.95,
        roughnessMap: t.char,
        bumpMap: t.char,
        bumpScale: 2.5,
        emissive: new THREE.Color('#ff5a1f'),
        emissiveMap: t.crack,
        emissiveIntensity: 1.6,
      })
      break
    case 'travertino':
      m = new THREE.MeshPhysicalMaterial({ color: '#e7dcc6', map: t.trav, roughness: 0.78, bumpMap: t.trav, bumpScale: 0.6 })
      break
    case 'laca':
      m = new THREE.MeshPhysicalMaterial({ color: '#b3170f', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.3, sheenColor: new THREE.Color('#ffb199') })
      break
  }
  return dissolve(m, side, kind)
}

// ---------- palco ----------

export class Stage {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  geo: THREE.ExtrudeGeometry
  rig = new THREE.Group()
  meshA: THREE.Mesh
  meshB: THREE.Mesh
  swarm: THREE.InstancedMesh
  key: THREE.DirectionalLight
  rim: THREE.DirectionalLight
  bg = new THREE.Color('#ece6dc')
  mats: Record<string, { a: THREE.MeshPhysicalMaterial; b: THREE.MeshPhysicalMaterial }> = {}

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.background = this.bg

    this.key = new THREE.DirectionalLight('#fff4e6', 2.2)
    this.key.position.set(-3, 4, 5)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.radius = 8
    this.key.shadow.bias = -0.0005
    const sc = this.key.shadow.camera
    sc.left = sc.bottom = -4
    sc.right = sc.top = 4
    this.rim = new THREE.DirectionalLight('#ffd2a8', 1.6)
    this.rim.position.set(4, 1.5, -4)
    this.scene.add(this.key, this.rim, new THREE.AmbientLight('#ffffff', 0.15))

    // sombra num chão invisível
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.22 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -1.12
    floor.receiveShadow = true
    this.scene.add(floor)

    this.geo = izGeometry()
    const bb = this.geo.boundingBox!
    shared.uMinY.value = bb.min.y - 0.02
    shared.uH.value = bb.max.y - bb.min.y + 0.04

    for (const k of ['porcelana', 'terracota', 'espelho', 'gelo', 'brasa', 'travertino', 'laca'] as Kind[]) this.mats[k] = { a: makeMaterial(k, 1), b: makeMaterial(k, -1) }
    this.meshA = new THREE.Mesh(this.geo, this.mats.porcelana.a)
    this.meshB = new THREE.Mesh(this.geo, this.mats.porcelana.b)
    for (const m of [this.meshA, this.meshB]) {
      m.castShadow = true
      m.receiveShadow = true
      this.rig.add(m)
    }
    this.scene.add(this.rig)

    // enxame: 520 cópias pequenas
    const small = izGeometry(0.2, 8, 1)
    const sm = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 })
    this.swarm = new THREE.InstancedMesh(small, sm, 520)
    this.swarm.castShadow = true
    this.swarm.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.swarm.count = 0
    const palette = ['#f1ece2', '#b5603a', '#c9d3da', '#c7b9f0', '#2a2220', '#e7dcc6', '#b3170f']
    const col = new THREE.Color()
    for (let i = 0; i < 520; i++) this.swarm.setColorAt(i, col.set(palette[i % palette.length]))
    this.scene.add(this.swarm)

    this.resize()
  }

  setPair(a: Kind, b: Kind) {
    this.meshA.material = this.mats[a].a
    this.meshB.material = this.mats[b].b
  }

  // compila todos os programas antes de mostrar a página
  async warm() {
    for (const k of Object.keys(this.mats)) {
      this.meshA.material = this.mats[k].a
      this.meshB.material = this.mats[k].b
      await this.renderer.compileAsync(this.scene, this.camera)
    }
    this.setPair('porcelana', 'porcelana')
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.position.set(0, 0.05, w < 861 ? 9.5 : 6.2)
    this.camera.updateProjectionMatrix()
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
