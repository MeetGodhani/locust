import { LOCUST_LINK_SCHEME, type LocustLink } from '../shared/locust-link.js'

/** The part of Electron's app that knows which program a link scheme opens. */
export interface LinkSchemeHost {
  isDefaultProtocolClient(scheme: string): boolean
  setAsDefaultProtocolClient(scheme: string): boolean
}

/**
 * WINDOWS LEARNS WHERE locust:// LINKS GO FROM THE INSTALLED COPY (0.770). macOS and Linux read it from the app's
 * own description (electron-builder.yml `protocols`); Windows from the registry, which only the installed copy,
 * started by a person, writes. A copy a test drives, or one checking for updates, would take every link from the
 * installed one; a development build would send them to Electron itself.
 */
export function claimLinks(options: {
  readonly platform: NodeJS.Platform
  readonly packaged: boolean
  readonly installed: boolean
  readonly argv: readonly string[]
  readonly host: LinkSchemeHost
}): boolean {
  if (options.platform !== 'win32' || !options.packaged || !options.installed) return false
  if (options.argv.some((argument) => argument.startsWith('--remote-debugging-port') || argument === '--update-check-only')) return false
  if (options.host.isDefaultProtocolClient(LOCUST_LINK_SCHEME)) return false
  return options.host.setAsDefaultProtocolClient(LOCUST_LINK_SCHEME)
}

/**
 * WHERE A LINK WAITS FOR THE WINDOW (0.770, shared/locust-link.ts). A link that starts Locust arrives before there is
 * a window to show it, and one that arrives while Locust runs may land as the window loads; so the host keeps the
 * newest here and tells the window, which takes it once. A link nobody took within a minute is let go: a window
 * opened much later should not find a message it was never shown arriving.
 */
export interface LinkInbox {
  arrive(link: LocustLink): void
  take(): LocustLink | undefined
}

export function createLinkInbox(options: { readonly now?: () => number; readonly keepMs?: number } = {}): LinkInbox {
  const now = options.now ?? Date.now
  const keepMs = options.keepMs ?? 60_000
  let waiting: { readonly link: LocustLink; readonly at: number } | undefined
  return {
    arrive(link) {
      waiting = { link, at: now() }
    },
    take() {
      const held = waiting
      waiting = undefined
      return held === undefined || now() - held.at > keepMs ? undefined : held.link
    }
  }
}
