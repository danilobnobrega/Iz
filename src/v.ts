import '@fontsource-variable/jetbrains-mono'
import '@fontsource/instrument-serif'
import { Engine } from './v/engine'
import { Sound } from './v/sound'
import { Marca } from './v/marca'
import { Vitrine } from './v/vitrine'
import { Po } from './v/po'
import { Label } from './v/type'

// Proposta V — o Íz como um mundo só, desenhado inteiro em WebGL (inclusive o texto).

async function boot() {
  await Promise.all([
    document.fonts.load('11px "JetBrains Mono Variable"'),
    document.fonts.load('34px "Instrument Serif"'),
  ])
  const sound = new Sound()
  const engine = new Engine(document.querySelector<HTMLCanvasElement>('.v-gl')!, sound)
  const marca = new Marca(engine.r, engine.ov)
  engine.add(marca)
  const vitrine = new Vitrine(engine.r, engine.ov)
  engine.add(vitrine)
  const po = new Po(engine.r, engine.ov, Math.min(innerWidth, innerHeight) < 600)
  engine.add(po)
  po.buildTargets()
  engine.resize()
  engine.start()

  // carregamento: uma onda de caracteres e a contagem das gravações prontas
  const wave = '---===+++==='
  const load = new Label(engine.ov, '', { size: 10.5, spacing: 0.8, align: 'center', dur: 0.4 })
  let done = 0
  let tick = 0
  const draw = () => {
    tick++
    let s = ''
    for (let i = 0; i < 28; i++) s += wave[(i + tick) % wave.length]
    const pct = String(Math.round((done / 7) * 100)).padStart(3, '0')
    load.set(`${s}

${pct}`)
    load.dirty = true
    load.place(innerWidth / 2, innerHeight / 2 - 20)
  }
  draw()
  load.show(true)
  const iv = setInterval(draw, 70)
  await vitrine.load(() => done++)
  await new Promise((r) => setTimeout(r, 500))
  clearInterval(iv)
  load.show(false)
  await new Promise((r) => setTimeout(r, 450))
  load.dispose()

  marca.intro()
  engine.logo.show(true, 3.2)
  engine.soundLabel.show(true, 3.6)
  engine.sign.show(true, 3.8)
  setTimeout(() => (engine.inputOn = true), 3600)
  ;(window as any).__v = engine
  // atalho de teste: #at=7.5 começa naquela posição da rolagem
  const at = /at=([\d.]+)/.exec(location.hash)
  if (at) engine.target = engine.pos = engine.smooth1 = parseFloat(at[1])
}
boot()
