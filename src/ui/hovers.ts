import { pointer } from './pointer'

// Microinterações específicas de cada componente.
export function initHovers() {
  // links do menu: texto rola e é trocado pela cópia, letra a letra
  document.querySelectorAll<HTMLElement>('.roll > span').forEach((span) => {
    const text = span.dataset.text || span.textContent || ''
    span.textContent = ''
    ;[...text].forEach((c, i) => {
      const ch = document.createElement('span')
      ch.className = 'ch'
      ch.textContent = c
      ch.dataset.c = c
      ch.style.setProperty('--i', String(i))
      span.appendChild(ch)
    })
  })

  // pílulas: o fundo enche a partir do ponto de entrada do cursor
  document.querySelectorAll<HTMLElement>('.pill').forEach((pill) => {
    const set = (e: PointerEvent) => {
      const r = pill.getBoundingClientRect()
      pill.style.setProperty('--x', `${e.clientX - r.left}px`)
      pill.style.setProperty('--y', `${e.clientY - r.top}px`)
    }
    pill.addEventListener('pointerenter', set)
    pill.addEventListener('pointerleave', set)
  })

  // casas: cada linha assume a cor da casa
  document.querySelectorAll<HTMLElement>('.casa').forEach((casa) => {
    casa.style.setProperty('--casa', casa.dataset.accent || '#111110')
    casa.dataset.cursor = 'Visitar'
  })
  document.querySelectorAll<HTMLElement>('.bts figure').forEach((f) => (f.dataset.cursor = 'Ver'))

  // reconhecimento: a imagem da matéria segue o cursor
  const img = document.createElement('img')
  img.className = 'premio-img'
  img.alt = ''
  document.body.appendChild(img)
  let active = false
  let x = 0
  let y = 0
  document.querySelectorAll<HTMLElement>('.premios li').forEach((li) => {
    li.addEventListener('pointerenter', () => {
      img.src = li.dataset.img || ''
      active = true
      img.style.opacity = '1'
    })
    li.addEventListener('pointerleave', () => {
      active = false
      img.style.opacity = '0'
    })
  })
  return (dt: number) => {
    const k = 1 - Math.pow(0.002, dt)
    const vx = pointer.x - x
    x += vx * k
    y += (pointer.y - y) * k
    const rot = Math.max(-12, Math.min(12, vx * 0.08))
    img.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${active ? 1 : 0.85})`
  }
}
