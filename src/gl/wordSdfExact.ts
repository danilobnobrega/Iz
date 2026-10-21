import * as THREE from 'three'
import opentype from 'opentype.js'
import { BASE, type WordAtlas } from './wordSdf'

// Campo de distância EXATO das palavras, calculado na GPU a partir dos contornos vetoriais da
// fonte (curvas achatadas em segmentos menores que meio pixel). Sem raster no meio do caminho,
// as paredes das letras ficam lisas mesmo sob luz rasante.

const BAKE = /* glsl */ `
  precision highp float;
  uniform sampler2D tSeg;
  uniform int uN;
  uniform float uSegW, uH, uY0;
  void main(){
    vec2 p = vec2(gl_FragCoord.x, gl_FragCoord.y - uY0);
    float dmin = 1e9;
    int wind = 0;
    for (int i = 0; i < 16384; i++) {
      if (i >= uN) break;
      vec4 s = texelFetch(tSeg, ivec2(i % int(uSegW), i / int(uSegW)), 0);
      vec2 a = s.xy, b = s.zw;
      vec2 pa = p - a, ba = b - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
      dmin = min(dmin, length(pa - ba * h));
      // regra do número de voltas (não-zero): raio horizontal para a direita
      if (a.y <= p.y) {
        if (b.y > p.y && (ba.x * pa.y - ba.y * pa.x) > 0.0) wind++;
      } else if (b.y <= p.y && (ba.x * pa.y - ba.y * pa.x) < 0.0) wind--;
    }
    float d = (wind != 0 ? -dmin : dmin) / uH;
    gl_FragColor = vec4(clamp(d, -0.5, 0.5), 0.0, 0.0, 1.0);
  }`

function flatten(path: any, H: number) {
  const segs: number[] = []
  let sx = 0, sy = 0, cx = 0, cy = 0
  const push = (x0: number, y0: number, x1: number, y1: number) => segs.push(x0, H - y0, x1, H - y1)
  for (const c of path.commands as any[]) {
    if (c.type === 'M') {
      sx = cx = c.x
      sy = cy = c.y
    } else if (c.type === 'L') {
      push(cx, cy, c.x, c.y)
      cx = c.x
      cy = c.y
    } else if (c.type === 'Q') {
      const n = Math.min(64, Math.max(4, Math.ceil(Math.hypot(c.x - cx, c.y - cy) / 0.4)))
      let px = cx, py = cy
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t
        const x = u * u * cx + 2 * u * t * c.x1 + t * t * c.x
        const y = u * u * cy + 2 * u * t * c.y1 + t * t * c.y
        push(px, py, x, y)
        px = x
        py = y
      }
      cx = c.x
      cy = c.y
    } else if (c.type === 'C') {
      const n = Math.min(96, Math.max(6, Math.ceil(Math.hypot(c.x - cx, c.y - cy) / 0.4)))
      let px = cx, py = cy
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t
        const x = u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x
        const y = u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y
        push(px, py, x, y)
        px = x
        py = y
      }
      cx = c.x
      cy = c.y
    } else if (c.type === 'Z') {
      if (cx !== sx || cy !== sy) push(cx, cy, sx, sy)
      cx = sx
      cy = sy
    }
  }
  return segs
}

export async function wordAtlasExact(r: THREE.WebGLRenderer, words: string[], fontUrl: string, W = 1024, H = 400): Promise<WordAtlas> {
  const buf = await (await fetch(fontUrl)).arrayBuffer()
  const font = opentype.parse(buf)
  const N = words.length
  const rt = new THREE.WebGLRenderTarget(W, H * N, {
    type: THREE.HalfFloatType,
    format: THREE.RedFormat,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  })
  const mat = new THREE.ShaderMaterial({
    vertexShader: `void main(){ gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: BAKE,
    depthTest: false,
    uniforms: { tSeg: { value: null }, uN: { value: 0 }, uSegW: { value: 1024 }, uH: { value: H }, uY0: { value: 0 } },
  })
  const scene = new THREE.Scene()
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  scene.add(quad)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const prevTarget = r.getRenderTarget()
  words.forEach((word, k) => {
    // mesmo encaixe do atlas por raster: altura 0.78, largura até 0.86, linha de base comum
    const adv = font.getAdvanceWidth(word, 1)
    const size = Math.min(H * 0.78, (W * 0.86) / adv)
    const x0 = (W - adv * size) / 2
    const path = font.getPath(word, x0, H * BASE, size)
    const segs = flatten(path, H)
    const n = segs.length / 4
    const SW = 1024
    const rows = Math.ceil(n / SW)
    const data = new Float32Array(SW * rows * 4)
    data.set(segs)
    const tex = new THREE.DataTexture(data, SW, rows, THREE.RGBAFormat, THREE.FloatType)
    tex.needsUpdate = true
    mat.uniforms.tSeg.value = tex
    mat.uniforms.uN.value = n
    mat.uniforms.uY0.value = k * H
    rt.viewport.set(0, k * H, W, H)
    rt.scissor.set(0, k * H, W, H)
    rt.scissorTest = true
    r.setRenderTarget(rt)
    r.render(scene, cam)
    tex.dispose()
  })
  r.setRenderTarget(prevTarget)
  ;(rt.texture as any).image = { width: W, height: H * N }
  return { texture: rt.texture as unknown as THREE.DataTexture, count: N, aspect: W / H }
}
