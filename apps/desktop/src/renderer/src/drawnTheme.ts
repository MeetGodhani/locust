import { useEffect, useState } from 'react'

/**
 * The theme the window is drawn in now (0.789): what `data-theme` on the root says, kept current.
 *
 * For the few pieces that paint themselves rather than take the stylesheet's tokens -- the send button's metal,
 * the beam around a card, the thinking orb. Each was pinned to dark, because Locust was dark whatever the computer
 * was ("`auto` falls back to the OS setting and Locust is dark regardless"); now Locust is what the person chose,
 * so they follow the page, never the computer.
 */
export function drawnTheme(): 'dark' | 'light' {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function useDrawnTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState(drawnTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(drawnTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}
