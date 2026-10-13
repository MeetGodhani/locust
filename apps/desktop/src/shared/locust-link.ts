/**
 * A LINK THAT OPENS LOCUST WITH A MESSAGE READY (0.770).
 *
 * From the 2026-10-13 look through t3code (Colin: "sounds good ill run with all your recs"). A README, a page or a
 * colleague can hand someone a prompt as a link, `locust://new?prompt=...`, and Locust opens a new conversation
 * with that message in the box.
 *
 * IT IS NEVER SENT. A link is text from somewhere else, so the person reads it and presses Send, or does not, and
 * the box says where it came from. And what they read is all there is: characters a person cannot see but a model
 * reads -- Unicode tag characters (the "ASCII smuggling" of a hidden instruction), direction overrides that show
 * text in an order it is not sent in, zero-width marks, control characters -- are taken out before it reaches the
 * box. Only a new conversation's text: no folder, teammate, model or file, which would act on the machine before
 * anyone read anything.
 */
export const LOCUST_LINK_SCHEME = 'locust'
/** The host tells the window a link is waiting; the window takes it (it may arrive before the window exists). */
export const LOCUST_LINK_WAITING = 'locust-link:waiting'
export const LOCUST_LINK_TAKE = 'locust-link:take'

/** The longest message a link may bring: a long, careful prompt is a few thousand characters. */
export const MAX_LINK_PROMPT_CHARS = 8_000

export interface LocustLink {
  /** The message for the box, as the person will read it and as it would be sent. */
  readonly prompt: string
}

/** What the window may ask of links (0.770). */
export interface LocustLinkApi {
  /** The waiting link, once; nothing when none is waiting. */
  take(): Promise<LocustLink | undefined>
  /** Each time a link arrives while the window is open. Returns the way to stop listening. */
  onWaiting(listener: () => void): () => void
}

/**
 * What a person cannot see in a message box: C0 and C1 controls but tab and newline, zero-width marks and
 * joiners, direction marks, embeddings, overrides and isolates, the byte-order mark, the invisible math operators,
 * variation selectors, and the tag characters.
 */
const UNSEEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁯︀-️﻿]|\udb40[\udc00-\udc7f]|\udb40[\udd00-\uddef]/g

/** The message as the person will see it, and nothing they will not. */
export function seenText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(UNSEEN, '').trim()
}

/** Reads a link, or nothing for anything that is not one Locust opens. */
export function parseLocustLink(raw: string): LocustLink | undefined {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_PROMPT_CHARS * 12) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== `${LOCUST_LINK_SCHEME}:`) return undefined
  // locust://new?..., and the locust:new?... and locust:///new?... spellings a system may hand over.
  const action = (url.hostname.length > 0 ? url.hostname : url.pathname.replace(/^\/+/, '').split('/')[0] ?? '').toLowerCase()
  if (action !== 'new') return undefined
  const given = url.searchParams.get('prompt')
  if (given === null) return undefined
  const prompt = seenText(given)
  if (prompt.length === 0 || prompt.length > MAX_LINK_PROMPT_CHARS) return undefined
  return { prompt }
}

/** The link that opens Locust with `prompt` in the box. */
export function locustLinkFor(prompt: string): string {
  return `${LOCUST_LINK_SCHEME}://new?prompt=${encodeURIComponent(prompt)}`
}

/** A link among a launch's arguments: Windows and Linux hand the link to the app that way. */
export function linkInArguments(argv: readonly string[]): LocustLink | undefined {
  for (const argument of argv) {
    if (!argument.toLowerCase().startsWith(`${LOCUST_LINK_SCHEME}:`)) continue
    const link = parseLocustLink(argument)
    if (link !== undefined) return link
  }
  return undefined
}
