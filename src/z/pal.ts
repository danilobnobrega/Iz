import * as THREE from 'three'

// Paleta da proposta Z: saturada, com creme e tinta para respirar.
export const PAL = {
  cream: '#f3ecdf',
  ink: '#121012',
  tomato: '#ff4b23',
  cobalt: '#2340ff',
  saffron: '#ffb31a',
  pistachio: '#a6d16b',
  pink: '#ff9fcf',
}
export const v3 = (hex: string) => {
  const c = new THREE.Color(hex)
  return new THREE.Vector3(c.r, c.g, c.b) // valores sRGB crus (os shaders escrevem direto na tela)
}
// THREE.Color converte para linear quando o gerenciamento de cor está ligado; aqui queremos os
// números do hex como estão
export const raw = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}
export const DISPLAY = '"Big Shoulders Display Variable", Impact, sans-serif'
