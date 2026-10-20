precision highp float;

uniform sampler2D tMap;
uniform float uPlaneAspect;
uniform float uImageAspect;
uniform float uDim;
uniform vec3 uBg;

varying vec2 vUv;
varying float vFog;

void main() {
  vec2 uv = vUv - 0.5;
  if (uPlaneAspect > uImageAspect) uv.y *= uImageAspect / uPlaneAspect;
  else uv.x *= uPlaneAspect / uImageAspect;
  vec3 col = texture2D(tMap, uv + 0.5).rgb;
  col *= uDim;
  col = mix(col, uBg, vFog * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
