import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { typeText } from './text'

// Moldura fixa: relógio de Goiânia, ficha da seção atual, cor de acento por seção.
const clockFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function initClock() {
  const el = document.querySelector<HTMLElement>('.ficha__clock')
  if (!el) return
  const tick = () => (el.textContent = clockFmt.format(new Date()))
  tick()
  setInterval(tick, 1000)
}

const root = document.documentElement
const accent = { c: '#111110' }

export function setAccent(color: string) {
  gsap.to(accent, {
    c: color,
    duration: 0.8,
    ease: 'power2.out',
    onUpdate: () => root.style.setProperty('--accent', accent.c),
  })
}

export function initSections(o: { selector?: string; containerAnimation?: gsap.core.Animation } = {}) {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(o.selector || 'main > .s'))
  const index = document.querySelector<HTMLElement>('.ficha__index')!
  const name = document.querySelector<HTMLElement>('.ficha__name')!
  const total = String(sections.length).padStart(2, '0')
  let current: HTMLElement | null = null

  const activate = (s: HTMLElement) => {
    if (current === s) return
    current = s
    const i = sections.indexOf(s)
    index.textContent = `${String(i + 1).padStart(2, '0')} / ${total}`
    typeText(name, s.dataset.name || '')
    setAccent(s.dataset.accent || '#111110')
    document.body.classList.toggle('on-dark', s.classList.contains('is-dark'))
  }

  sections.forEach((s) => {
    ScrollTrigger.create({
      trigger: s,
      start: o.containerAnimation ? 'left 50%' : 'top 50%',
      end: o.containerAnimation ? 'right 50%' : 'bottom 50%',
      containerAnimation: o.containerAnimation,
      onToggle: (self) => self.isActive && activate(s),
    })
  })
  return { start: () => activate(sections[0]) }
}
