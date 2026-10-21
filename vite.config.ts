import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import { resolve } from 'path'

export default defineConfig({
  plugins: [glsl()],
  server: { host: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        grade: resolve(__dirname, 'grade.html'),
        horizontal: resolve(__dirname, 'horizontal.html'),
        indice: resolve(__dirname, 'indice.html'),
        fluido: resolve(__dirname, 'fluido.html'),
        editorial: resolve(__dirname, 'editorial.html'),
        papel: resolve(__dirname, 'papel.html'),
        mosaico: resolve(__dirname, 'mosaico.html'),
        gravidade: resolve(__dirname, 'gravidade.html'),
        materia: resolve(__dirname, 'materia.html'),
        toalha: resolve(__dirname, 'toalha.html'),
        fenda: resolve(__dirname, 'fenda.html'),
        m: resolve(__dirname, 'm.html'),
        n: resolve(__dirname, 'n.html'),
        o: resolve(__dirname, 'o.html'),
        p: resolve(__dirname, 'p.html'),
        q: resolve(__dirname, 'q.html'),
        r: resolve(__dirname, 'r.html'),
        s: resolve(__dirname, 's.html'),
        t: resolve(__dirname, 't.html'),
        u: resolve(__dirname, 'u.html'),
        v: resolve(__dirname, 'v.html'),
        w: resolve(__dirname, 'w.html'),
        x: resolve(__dirname, 'x.html'),
        y: resolve(__dirname, 'y.html'),
        z: resolve(__dirname, 'z.html'),
        aa: resolve(__dirname, 'aa.html'),
      },
    },
  },
})
