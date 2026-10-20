import * as THREE from 'three'

// Cópias fotográficas em WebGL, presas a elementos do DOM. Cada cópia pode
// enrolar (virar página), dobrar em sanfona, virar, deitar e se montar em lâminas.

THREE.ColorManagement.enabled = false

const vert = /* glsl */ `
  uniform vec2 uSize;
  uniform float uCurl;
  uniform vec2 uCurlDir;
  uniform float uCurlR;
  uniform float uFold;
  uniform float uFoldN;
  uniform float uFlip;
  uniform float uTilt;
  uniform float uSlat;
  uniform float uSlatN;
  uniform float uBow;

  varying vec2 vUv;
  varying float vShade;
  varying float vGloss;

  const float PI = 3.14159265;

  void main() {
    vUv = uv;
    vec3 p = vec3(position.xy * uSize, 0.0);
    float shade = 1.0;
    float gloss = 0.0;
    float W = uSize.x;
    float H = uSize.y;

    // lâminas: faixas verticais que giram no próprio eixo
    if (uSlatN > 0.0) {
      float u = clamp(p.x / W + 0.5, 0.0, 0.9999);
      float i = floor(u * uSlatN);
      float cx = (i + 0.5) / uSlatN * W - W * 0.5;
      float local = p.x - cx;
      float k = clamp(uSlat * 1.7 - (i / uSlatN) * 0.7, 0.0, 1.0);
      float a = (1.0 - k * k * (3.0 - 2.0 * k)) * PI * 0.5;
      p.x = cx + local * cos(a);
      p.z += -local * sin(a);
      shade *= mix(1.0, 0.55, sin(a));
    }

    // sanfona: painéis alternados em zigue-zague
    if (uFoldN > 0.0 && uFold > 0.0) {
      float a = uFold * PI * 0.44;
      float pw = W / uFoldN;
      float u = p.x + W * 0.5;
      float i = floor(clamp(u / pw, 0.0, uFoldN - 0.001));
      float t = u - i * pw;
      float even = mod(i, 2.0);
      float x = i * pw * cos(a) + t * cos(a);
      float z = (even < 0.5 ? t : pw - t) * sin(a);
      p.x = x - W * cos(a) * 0.5;
      p.z += z;
      shade *= even < 0.5 ? mix(1.0, 0.72, sin(a)) : mix(1.0, 1.08, sin(a));
    }

    // deitar sobre a mesa: gira em X pela base
    if (uTilt != 0.0) {
      float y = p.y + H * 0.5;
      p.y = y * cos(uTilt) - H * 0.5;
      p.z += -y * sin(uTilt);
      shade *= mix(1.0, 0.86, abs(sin(uTilt)));
    }

    // virar: gira em Y com o papel arqueando no meio do giro
    if (uFlip > 0.0) {
      float a = uFlip * PI;
      float arch = sin(a) * W * 0.16 * (1.0 - pow(p.x / (W * 0.5), 2.0));
      float x = p.x;
      p.x = x * cos(a);
      p.z += x * sin(a) + arch;
      shade *= mix(1.0, 0.8, sin(a));
      gloss += pow(sin(a), 6.0) * 0.12;
    }

    // enrolar: a página vira em torno de um cilindro que atravessa a cópia
    if (uCurl > 0.0) {
      vec2 n = normalize(uCurlDir);
      float smax = abs(n.x) * W * 0.5 + abs(n.y) * H * 0.5;
      float R = uCurlR;
      float L = mix(smax, -smax - PI * R, uCurl);
      float s = dot(p.xy, n);
      if (s > L) {
        float theta = (s - L) / R;
        float s2;
        float z;
        if (theta < PI) {
          s2 = L + R * sin(theta);
          z = R * (1.0 - cos(theta));
          shade *= 1.0 - 0.35 * sin(theta);
          gloss += pow(sin(theta * 0.5 + 0.2), 14.0) * 0.22;
        } else {
          s2 = L - (s - L - PI * R);
          z = 2.0 * R;
          shade *= 0.92;
        }
        p.xy += n * (s2 - s);
        p.z += z;
      }
    }

    // a rolagem arqueia levemente a cópia
    p.z += uBow * (1.0 - pow(p.y / (H * 0.5), 2.0));

    vShade = shade;
    vGloss = gloss;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform vec2 uSize;
  uniform float uAspectA;
  uniform float uAspectB;
  uniform float uHasBack;
  uniform float uAlpha;
  uniform vec3 uPaper;
  uniform float uZoom;
  uniform float uBorder;
  varying vec2 vUv;
  varying float vShade;
  varying float vGloss;

  vec2 cover(vec2 uv, float img) {
    float pa = uSize.x / uSize.y;
    vec2 s = pa > img ? vec2(1.0, img / pa) : vec2(pa / img, 1.0);
    return (uv - 0.5) * s / uZoom + 0.5;
  }

  void main() {
    vec3 col;
    if (gl_FrontFacing) {
      col = texture2D(tA, cover(vUv, uAspectA)).rgb;
    } else if (uHasBack > 0.5) {
      col = texture2D(tB, cover(vec2(1.0 - vUv.x, vUv.y), uAspectB)).rgb;
    } else {
      // verso do papel fotográfico, com um fantasma da imagem
      vec3 ghost = texture2D(tA, cover(vec2(1.0 - vUv.x, vUv.y), uAspectA)).rgb;
      col = mix(uPaper, ghost, 0.06);
    }
    col *= vShade;
    col += vGloss;
    // margem de papel, como uma cópia impressa
    if (uBorder > 0.0) {
      vec2 px = vUv * uSize;
      float b = min(min(px.x, uSize.x - px.x), min(px.y, uSize.y - px.y));
      col = mix(uPaper * vShade + vGloss, col, smoothstep(uBorder - 0.75, uBorder + 0.75, b));
    }
    gl_FragColor = vec4(col, uAlpha);
  }
`

export type Fx = {
  curl?: number
  curlDir?: [number, number]
  curlR?: number
  fold?: number
  foldN?: number
  flip?: number
  tilt?: number
  slat?: number
  slatN?: number
  alpha?: number
  zoom?: number
  z?: number
  rot?: number
}

export class Print {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  fx: Fx = {}
  constructor(public el: HTMLElement, public a: THREE.Texture, public b: THREE.Texture | null, paper: THREE.Color, fullBleed = false) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {
        tA: { value: a },
        tB: { value: b ?? a },
        uSize: { value: new THREE.Vector2(1, 1) },
        uAspectA: { value: aspect(a) },
        uAspectB: { value: aspect(b ?? a) },
        uHasBack: { value: b ? 1 : 0 },
        uBorder: { value: fullBleed ? 0 : 7 },
        uAlpha: { value: 1 },
        uPaper: { value: paper },
        uZoom: { value: 1 },
        uCurl: { value: 0 },
        uCurlDir: { value: new THREE.Vector2(1, -1) },
        uCurlR: { value: 60 },
        uFold: { value: 0 },
        uFoldN: { value: 0 },
        uFlip: { value: 0 },
        uTilt: { value: 0 },
        uSlat: { value: 1 },
        uSlatN: { value: 0 },
        uBow: { value: 0 },
      },
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 96, 96), mat)
    this.mesh.frustumCulled = false
  }
  setB(t: THREE.Texture) {
    this.b = t
    this.mesh.material.uniforms.tB.value = t
    this.mesh.material.uniforms.uAspectB.value = aspect(t)
  }
  setA(t: THREE.Texture) {
    this.a = t
    this.mesh.material.uniforms.tA.value = t
    this.mesh.material.uniforms.uAspectA.value = aspect(t)
  }
}

function aspect(t: THREE.Texture) {
  const img = t.image as HTMLImageElement | undefined
  return img && img.width ? img.width / img.height : 1
}

export class PaperStage {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(30, 1, 10, 10000)
  prints: Print[] = []
  paper = new THREE.Color('#ece6db')
  private loader = new THREE.TextureLoader()
  private cache = new Map<string, Promise<THREE.Texture>>()
  private w = 1
  private h = 1
  bow = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.resize()
  }

  texture(src: string) {
    if (!this.cache.has(src))
      this.cache.set(
        src,
        new Promise((resolve) =>
          this.loader.load(src, (t) => {
            t.colorSpace = THREE.NoColorSpace
            t.anisotropy = 8
            t.minFilter = THREE.LinearMipmapLinearFilter
            resolve(t)
          }),
        ),
      )
    return this.cache.get(src)!
  }

  add(p: Print) {
    this.prints.push(p)
    this.scene.add(p.mesh)
    return p
  }

  resize() {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.w, this.h, false)
    // câmera posicionada pra que 1 unidade = 1 pixel no plano z = 0
    const fov = this.camera.fov * (Math.PI / 180)
    this.camera.aspect = this.w / this.h
    this.camera.position.set(0, 0, this.h / 2 / Math.tan(fov / 2))
    this.camera.near = 10
    this.camera.far = this.camera.position.z * 3
    this.camera.updateProjectionMatrix()
  }

  render() {
    for (const p of this.prints) {
      const r = p.el.getBoundingClientRect()
      const visible = r.bottom > -this.h * 0.5 && r.top < this.h * 1.5 && (p.fx.alpha ?? 1) > 0.001
      p.mesh.visible = visible
      if (!visible) continue
      const u = p.mesh.material.uniforms
      u.uSize.value.set(r.width, r.height)
      p.mesh.position.set(r.left + r.width / 2 - this.w / 2, this.h / 2 - (r.top + r.height / 2), p.fx.z ?? 0)
      p.mesh.rotation.z = p.fx.rot ?? 0
      u.uCurl.value = p.fx.curl ?? 0
      if (p.fx.curlDir) u.uCurlDir.value.set(...p.fx.curlDir)
      u.uCurlR.value = p.fx.curlR ?? Math.max(40, Math.min(r.width, r.height) * 0.09)
      u.uFold.value = p.fx.fold ?? 0
      u.uFoldN.value = p.fx.foldN ?? 0
      u.uFlip.value = p.fx.flip ?? 0
      u.uTilt.value = p.fx.tilt ?? 0
      u.uSlat.value = p.fx.slat ?? 1
      u.uSlatN.value = p.fx.slatN ?? 0
      u.uAlpha.value = p.fx.alpha ?? 1
      u.uZoom.value = p.fx.zoom ?? 1
      u.uBow.value = this.bow
    }
    this.renderer.render(this.scene, this.camera)
  }
}
