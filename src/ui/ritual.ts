import gsap from 'gsap'
import type Lenis from 'lenis'
import { typeText } from './text'

// Ritual de transição: o painel cobre a tela, o nome do destino digita, a página muda por baixo, o painel sai.
// `resolve` permite trilhos horizontais calcularem a posição de scroll do destino
export function initRitual(lenis: Lenis | null, resolve?: (target: HTMLElement) => number) {
  const panel = document.querySelector<HTMLElement>('.ritual')!
  const name = panel.querySelector<HTMLElement>('.ritual__name')!
  let busy = false

  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-goto]')
    if (!a) return
    e.preventDefault()
    if (busy) return
    const target = document.querySelector<HTMLElement>(a.dataset.goto!)
    if (!target) return
    busy = true
    const label = target.dataset.name || ''
    name.textContent = ''
    gsap
      .timeline({ onComplete: () => void (busy = false) })
      .set(panel, { yPercent: 101 })
      .to(panel, { yPercent: 0, duration: 0.7, ease: 'expo.inOut' })
      .add(() => void typeText(name, label, 28))
      .to({}, { duration: Math.max(0.55, label.length / 28 + 0.25) })
      .add(() => {
        const y = resolve ? resolve(target) : target.getBoundingClientRect().top + window.scrollY
        if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
        else window.scrollTo(0, y)
      })
      .to(panel, { yPercent: -101, duration: 0.8, ease: 'expo.inOut' }, '+=0.1')
  })
}
