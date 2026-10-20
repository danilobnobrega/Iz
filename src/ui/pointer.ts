import * as THREE from 'three'

// Estado único do ponteiro, compartilhado entre DOM e WebGL.
export const pointer = {
  x: window.innerWidth / 2, // px, origem no topo
  y: window.innerHeight / 2,
  uv: new THREE.Vector2(0.5, 0.5), // 0..1, origem embaixo (GL)
  smooth: new THREE.Vector2(), // -1..1 suavizado
  target: new THREE.Vector2(),
  moved: false,
}

function set(x: number, y: number) {
  pointer.x = x
  pointer.y = y
  pointer.uv.set(x / window.innerWidth, 1 - y / window.innerHeight)
  pointer.target.set((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1))
  pointer.moved = true
}

window.addEventListener('pointermove', (e) => set(e.clientX, e.clientY), { passive: true })
window.addEventListener('touchmove', (e) => e.touches[0] && set(e.touches[0].clientX, e.touches[0].clientY), { passive: true })

export function tickPointer(dt: number) {
  const k = 1 - Math.pow(0.0015, dt)
  pointer.smooth.lerp(pointer.target, k)
}
