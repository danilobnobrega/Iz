import * as THREE from 'three'

// Base da proposta Y: um único canvas fixo; cada seção desenha só dentro do retângulo da sua
// área presa (sticky). Assim há um contexto WebGL só e cada seção pode ter técnica própria.

export const PAPER = '#e3e0db' // o papel do site inteiro (igual ao fundo da porcelana)
export const INK = '#17130f'
export const PAPER_V = new THREE.Vector3(0xe3 / 255, 0xe0 / 255, 0xdb / 255)
export const INK_V = new THREE.Vector3(0x17 / 255, 0x13 / 255, 0x0f / 255)

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
export const fit = (v: number, a: number, b: number) => clamp((v - a) / (b - a))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const damp = (k: number, dt: number) => 1 - Math.pow(1 - k, dt * 60)
// a curva do site: arranque firme, chegada longa (cubic-bezier .35,0,0,1)
export function ease(t: number) {
  t = clamp(t)
  let x = t
  for (let i = 0; i < 6; i++) {
    const cx = 1.05, bx = -2.1, ax = 2.05
    const fx = ((ax * x + bx) * x + cx) * x - t
    const dx = (3 * ax * x + 2 * bx) * x + cx
    if (Math.abs(fx) < 1e-5 || Math.abs(dx) < 1e-6) break
    x -= fx / dx
  }
  x = clamp(x)
  return ((-2 * x + 3) * x + 0) * x
}

export type Pointer = { x: number; y: number; px: number; py: number; vx: number; vy: number; inside: boolean; down: boolean }
export type Rect = { x: number; y: number; w: number; h: number } // pixels css, origem no topo

export type Ctx = { r: THREE.WebGLRenderer; dpr: number; vw: number; vh: number; t: number; dt: number; ptr: Pointer }

export abstract class Section {
  w = 1
  h = 1
  dpr = 1
  constructor(public el: HTMLElement) {}
  async init(_r: THREE.WebGLRenderer): Promise<void> {}
  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.dpr = dpr
  }
  // p: progresso dentro da seção (0 = acabou de prender, 1 = vai soltar)
  abstract update(p: number, c: Ctx, rect: Rect): void
  abstract render(c: Ctx, rect: Rect): void
  // ponteiro em coordenadas da área (−1..1)
  local(c: Ctx, rect: Rect) {
    return { x: ((c.ptr.px - rect.x) / rect.w) * 2 - 1, y: -(((c.ptr.py - rect.y) / rect.h) * 2 - 1), inside: c.ptr.inside && c.ptr.py >= rect.y && c.ptr.py <= rect.y + rect.h }
  }
}

// desenha uma cena no retângulo da seção, no canvas da tela
export function toScreen(c: Ctx, rect: Rect, scene: THREE.Scene, cam: THREE.Camera) {
  const r = c.r
  const y = c.vh - rect.y - rect.h
  r.setRenderTarget(null)
  r.setViewport(rect.x, y, rect.w, rect.h)
  r.setScissor(rect.x, y, rect.w, rect.h)
  r.setScissorTest(true)
  r.render(scene, cam)
  r.setScissorTest(false)
}

export class Quad {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  mesh: THREE.Mesh
  constructor(mat?: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }
  draw(r: THREE.WebGLRenderer, mat: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.mesh.material = mat
    r.setRenderTarget(target)
    r.render(this.scene, this.cam)
  }
  screen(c: Ctx, rect: Rect, mat: THREE.Material) {
    this.mesh.material = mat
    toScreen(c, rect, this.scene, this.cam)
  }
}

export const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`

// texto de legenda: cada filho entra numa máscara, a partir da posição de rolagem
export function captions(root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-in]')).map((el) => {
    const inner = document.createElement('span')
    inner.className = 'y-in'
    while (el.firstChild) inner.appendChild(el.firstChild)
    el.appendChild(inner)
    el.classList.add('y-mask')
    const [a, b] = (el.dataset.in || '0,1').split(',').map(Number)
    return { el, inner, a, b }
  })
  return (p: number) => {
    for (const it of items) {
      const k = ease(fit(p, it.a, it.a + 0.08))
      const o = ease(fit(p, it.b - 0.06, it.b))
      it.inner.style.transform = `translate3d(0, ${((1 - k) * 110 - o * 110).toFixed(2)}%, 0)`
    }
  }
}
