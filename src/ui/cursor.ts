import { pointer } from './pointer'

// Cursor global: ponto na cor da seção; vira anel sobre links e disco com rótulo sobre mídia.
export function initCursor() {
  const el = document.querySelector<HTMLElement>('.cursor')
  if (!el || !matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {}
  const label = el.querySelector<HTMLElement>('.cursor__label')!
  let x = pointer.x
  let y = pointer.y

  document.addEventListener('pointerover', (e) => {
    const t = e.target as HTMLElement
    const media = t.closest<HTMLElement>('[data-cursor]')
    const link = t.closest('a, button')
    el.classList.toggle('is-media', !!media)
    el.classList.toggle('is-link', !media && !!link)
    if (media) label.textContent = media.dataset.cursor || ''
  })
  // a grade (proposta B) avisa qual foto está sob o cursor
  document.addEventListener('tilehover', (e) => {
    const area = e.target as HTMLElement
    el.classList.add('is-media')
    el.classList.remove('is-link')
    label.textContent = area.dataset.cursor || ''
  })
  document.addEventListener('pointerleave', () => (el.style.opacity = '0'))
  document.addEventListener('pointerenter', () => (el.style.opacity = '1'))

  return (dt: number) => {
    const k = 1 - Math.pow(0.000001, dt)
    x += (pointer.x - x) * k
    y += (pointer.y - y) * k
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }
}
