// Composição do hero: a marca Íz como janela para o mundo do grupo.
precision highp float;

uniform sampler2D tContent;
uniform sampler2D tSdf;
uniform sampler2D tTrail;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uGlyphH;
uniform float uAspect;
uniform float uSpread;
uniform float uScale;
uniform float uReveal;
uniform float uFill;
uniform float uDot;
uniform float uSoft;
uniform float uWobble;
uniform float uTime;
uniform float uDpr;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uDebug;

varying vec2 vUv;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float glyphDist(vec2 px) {
  float gh = uGlyphH * uScale;
  vec2 g = (px - uCenter) / gh;
  vec2 tuv = vec2(g.x / uAspect + 0.5, g.y + 0.5);
  float d = (texture2D(tSdf, clamp(tuv, 0.0, 1.0)).r - 0.5) * 2.0 * uSpread;
  // fora da textura: distância até a caixa + spread
  vec2 o = max(abs(tuv - 0.5) - 0.5, 0.0);
  if (o.x > 0.0 || o.y > 0.0) d = max(d, length(o * vec2(uAspect, 1.0)) + uSpread);
  return d * gh;
}

void main() {
  vec2 px = gl_FragCoord.xy / uDpr;
  vec4 trail = texture2D(tTrail, vUv);

  // o cursor empurra a borda
  vec2 push = trail.xy * 70.0;
  vec2 q = px - push;

  float dGlyph = glyphDist(q);
  float dCircle = length(q - uCenter) - uDot;
  float d = mix(dCircle, dGlyph, uReveal);

  // borda viva, mais mole quanto maior a escala
  float n = snoise(q / (uGlyphH * 0.22 * uScale) + uTime * 0.12) + 0.5 * snoise(q / (uGlyphH * 0.09 * uScale) - uTime * 0.2);
  d += n * uWobble * uReveal;

  float aa = 1.0;
  float inside = 1.0 - smoothstep(-aa, aa, d);

  // halo escuro do lado de fora, como uma lente
  float halo = (1.0 - smoothstep(0.0, uSoft, d)) * step(0.0, d);
  halo = pow(halo, 2.2);

  // refração perto da borda, por dentro: gradiente do campo limpo (sem ruído) pra não serrilhar
  float e = 2.0;
  vec2 grad = vec2(glyphDist(q + vec2(e, 0.0)) - glyphDist(q - vec2(e, 0.0)), glyphDist(q + vec2(0.0, e)) - glyphDist(q - vec2(0.0, e)));
  grad = mix(normalize(q - uCenter + 0.0001), grad / (length(grad) + 1e-4), uReveal);
  float edge = 1.0 - smoothstep(0.0, 34.0 + uSoft * 0.25, -d);
  vec2 refr = grad * edge * edge * 14.0;
  vec2 cuv = (px + refr - push * 0.35) / uRes;
  vec3 content = texture2D(tContent, cuv).rgb;
  // escurece levemente a borda por dentro
  content *= mix(1.0, 0.72, edge * 0.7);

  vec3 inner = mix(uInk, content, uFill);
  vec3 col = mix(uPaper, uInk, halo * 0.32 * uReveal);
  col = mix(col, inner, inside);

  // grão
  float gr = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  col += (gr - 0.5) * 0.035;

  if (uDebug > 0.5 && uDebug < 1.5) col = texture2D(tContent, vUv).rgb;
  if (uDebug > 1.5 && uDebug < 2.5) col = vec3(0.5 + d / 200.0);
  if (uDebug > 2.5) col = vec3(texture2D(tSdf, vUv).r);
  gl_FragColor = vec4(col, 1.0);
}
