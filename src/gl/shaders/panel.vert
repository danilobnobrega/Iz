// Painel de imagem curvado sobre um cilindro em volta da câmera.
uniform float uA0;
uniform float uR;
uniform float uY;
uniform float uW;
uniform float uBend;

varying vec2 vUv;
varying float vFog;

void main() {
  vUv = uv;
  float a = uA0 + (position.x * uW) / uR;
  vec3 curved = vec3(sin(a) * uR, uY + position.y, -cos(a) * uR);
  vec3 flat_ = vec3(sin(uA0) * uR + cos(uA0) * position.x * uW, uY + position.y, -cos(uA0) * uR + sin(uA0) * position.x * uW);
  vec3 p = mix(flat_, curved, uBend);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFog = smoothstep(4.0, 16.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
