import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Gramática de texto do site inteiro:
// [data-words]  títulos sobem palavra por palavra com leve rotação
// [data-type]   rótulos digitam com caracteres embaralhados
// [data-blur]   parágrafos saem do desfoque palavra por palavra, guiados pelo scroll
// [data-outline] palavras gigantes entram em contorno e preenchem com o scroll
// [data-count]  números contam

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/—·'
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

export function splitWords(el: HTMLElement, cls: 'w' | 'bw') {
  const nodes = Array.from(el.childNodes)
  el.textContent = ''
  const words: HTMLElement[] = []
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'BR') {
      el.appendChild(node)
      continue
    }
    const text = node.textContent || ''
    text.split(/(\s+)/).forEach((part) => {
      if (!part) return
      if (/^\s+$/.test(part)) {
        el.appendChild(document.createTextNode(' '))
        return
      }
      const outer = document.createElement('span')
      outer.className = cls
      if (cls === 'w') {
        const inner = document.createElement('span')
        inner.textContent = part
        outer.appendChild(inner)
        words.push(inner)
      } else {
        outer.textContent = part
        words.push(outer)
      }
      el.appendChild(outer)
    })
  }
  return words
}

// digita `text` em `el`, cada caractere passando por letras aleatórias antes de assentar
export function typeText(el: HTMLElement, text: string, speed = 34) {
  if (reduce) {
    el.textContent = text
    return
  }
  const state = { p: 0 }
  gsap.killTweensOf(state)
  const total = text.length
  return gsap.to(state, {
    p: 1,
    duration: Math.max(0.35, total / speed),
    ease: 'none',
    onUpdate: () => {
      const n = state.p * total
      let out = ''
      for (let i = 0; i < total; i++) {
        if (i < n - 2 || text[i] === ' ') out += text[i]
        else if (i < n) out += GLYPHS[(Math.random() * GLYPHS.length) | 0]
      }
      el.textContent = out
    },
    onComplete: () => {
      el.textContent = text
    },
  })
}

type Opts = { containerAnimation?: gsap.core.Animation; root?: ParentNode }

// em trilhos horizontais, 'top 88%' vira 'left 88%'
const at = (pos: string, o: Opts) => (o.containerAnimation ? pos.replace('top', 'left').replace('bottom', 'right') : pos)

export function initText(o: Opts = {}) {
  const root = o.root || document
  const ca = o.containerAnimation
  root.querySelectorAll<HTMLElement>('[data-words]').forEach((el) => {
    const words = splitWords(el, 'w')
    if (el.closest('#hero')) return // o hero entra pelo preloader
    gsap.set(words, { yPercent: 115, rotate: 7, transformOrigin: '0% 100%' })
    ScrollTrigger.create({
      trigger: el,
      start: at('top 88%', o),
      containerAnimation: ca,
      onEnter: () => gsap.to(words, { yPercent: 0, rotate: 0, duration: 1.15, ease: 'expo.out', stagger: 0.055 }),
      onLeaveBack: () => gsap.to(words, { yPercent: 115, rotate: 7, duration: 0.5, ease: 'power2.in', stagger: 0.02 }),
    })
  })

  root.querySelectorAll<HTMLElement>('[data-type]').forEach((el) => {
    if (el.closest('.ficha') || el.closest('#hero')) return
    const text = el.textContent || ''
    el.textContent = ''
    el.style.minHeight = '1.5em'
    ScrollTrigger.create({
      trigger: el,
      start: at('top 92%', o),
      containerAnimation: ca,
      onEnter: () => typeText(el, text),
      onLeaveBack: () => (el.textContent = ''),
    })
  })

  root.querySelectorAll<HTMLElement>('[data-blur]').forEach((el) => {
    const words = splitWords(el, 'bw')
    if (reduce) return
    gsap.set(words, { opacity: 0.12, filter: 'blur(7px)' })
    gsap.to(words, {
      opacity: 1,
      filter: 'blur(0px)',
      ease: 'none',
      stagger: 0.12,
      scrollTrigger: { trigger: el, start: at('top 86%', o), end: at('bottom 52%', o), scrub: 0.6, containerAnimation: ca },
    })
  })

  root.querySelectorAll<HTMLElement>('[data-outline]').forEach((el) => {
    if (reduce) {
      el.style.backgroundSize = '100% 100%'
      return
    }
    gsap.fromTo(
      el,
      { backgroundSize: '100% 0%' },
      { backgroundSize: '100% 100%', ease: 'none', scrollTrigger: { trigger: el, start: at('top 78%', o), end: at('bottom 45%', o), scrub: 0.5, containerAnimation: ca } },
    )
  })

  root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count)
    const n = { v: 0 }
    ScrollTrigger.create({
      trigger: el,
      start: at('top 85%', o),
      containerAnimation: ca,
      onEnter: () => gsap.to(n, { v: to, duration: 1.8, ease: 'expo.out', onUpdate: () => void (el.textContent = String(Math.round(n.v))) }),
      onLeaveBack: () => {
        n.v = 0
        el.textContent = '0'
      },
    })
    el.textContent = '0'
  })
}
