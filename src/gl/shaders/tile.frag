precision highp float;

uniform sampler2D tMap;
uniform float uPlaneAspect;
uniform float uImageAspect;
uniform float uHover;
uniform float uAlpha;
uniform float uGray;
uniform vec2 uVel;
uniform float uIn;

varying vec2 vUv;
varying float vEdge;

void main() {
  vec2 uv = vUv - 0.5;
  if (uPlaneAspect > uImageAspect) uv.y *= uImageAspect / uPlaneAspect;
  else uv.x *= uPlaneAspect / uImageAspect;
  uv *= 1.0 - uHover * 0.08;
  uv += 0.5;

  // separação de cor na direção do movimento
  vec2 sh = uVel * 0.012;
  vec3 col;
  col.r = texture2D(tMap, uv + sh).r;
  col.g = texture2D(tMap, uv).g;
  col.b = texture2D(tMap, uv - sh).b;

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l), uGray * (1.0 - uHover));

  // entrada: a imagem é revelada de baixo pra cima
  if (vUv.y > uIn) discard;

  gl_FragColor = vec4(col, uAlpha);
}
