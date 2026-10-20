// Rastro do cursor: campo de velocidade que decai. RG = velocidade, B = intensidade.
precision highp float;

uniform sampler2D tPrev;
uniform vec2 uMouse;
uniform vec2 uVel;
uniform float uAspect;
uniform float uDecay;
uniform float uRadius;

varying vec2 vUv;

void main() {
  vec4 prev = texture2D(tPrev, vUv - texture2D(tPrev, vUv).xy * 0.0035);
  vec2 vel = prev.xy * uDecay;
  float inten = prev.z * uDecay;

  vec2 d = vUv - uMouse;
  d.x *= uAspect;
  float g = exp(-dot(d, d) / uRadius);

  vel += uVel * g;
  inten += g * min(length(uVel) * 18.0, 1.0);

  gl_FragColor = vec4(clamp(vel, -1.0, 1.0), min(inten, 1.0), 1.0);
}
