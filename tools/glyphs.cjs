// Exporta os contornos reais da Fraunces (estática, 700) para JSON: o "Íz" em 3D sai da fonte, não de imagem.
const opentype = require('opentype.js')
const fs = require('fs')
const font = opentype.loadSync('node_modules/@fontsource/fraunces/files/fraunces-latin-700-normal.woff')
const out = {}
const path = font.getPath('Íz', 0, 0, 1)
out.iz = path.commands
const bb = path.getBoundingBox()
out.bbox = bb
fs.writeFileSync('src/data/iz-glyph.json', JSON.stringify(out))
console.log('comandos', path.commands.length, 'bbox', bb)
