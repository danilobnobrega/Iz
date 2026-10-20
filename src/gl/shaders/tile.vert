// Ladrilho da grade em espaço de pixels (câmera ortográfica), com curvatura de barril pela velocidade.
uniform vec2 uRes;
uniform float uBulge;
uniform float uZoom;

varying vec2 vUv;
varying float vEdge;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.xy *= uZoom;
  vec4 clip = projectionMatrix * viewMatrix * world;
  vec2 n = clip.xy;
  float r2 = dot(n * vec2(uRes.x / uRes.y, 1.0), n * vec2(uRes.x / uRes.y, 1.0));
  clip.xy = n * (1.0 - uBulge * r2);
  vEdge = r2;
  gl_Position = clip;
}
