import { expect, it } from 'vitest'

import { connectorMentioned, connectorsOffHint } from './connectorsOff.js'

/**
 * A DRAFT NAMING A CONNECTOR THE TEAMMATE HAS OFF SAYS SO (0.798). Connectors are off until ticked, so "check my
 * Gmail" to a teammate without them is told why before it is sent, not answered with "I have no Gmail".
 */
const NAMES = ['claude.ai Gmail', 'claude.ai Google Calendar', 'plugin:small-business:zoho-projects']

it('finds a connector named in the draft, by the name a person reads', () => {
  expect(connectorMentioned('can you check my gmail for the invoice', NAMES)).toBe('Gmail')
  expect(connectorMentioned('Add it to Google Calendar', NAMES)).toBe('Google Calendar')
  expect(connectorMentioned('update zoho projects', NAMES)).toBe('Zoho Projects')
})

it('does not find one inside another word, or where none is named', () => {
  expect(connectorMentioned('gmailx is a typo', NAMES)).toBeUndefined()
  expect(connectorMentioned('fix the login bug', NAMES)).toBeUndefined()
})

it('says whose, which, and where to turn it on', () => {
  expect(connectorsOffHint('Wren', 'Gmail')).toBe("Wren's connectors are off, so Gmail won't be in this turn. Tick it in Wren's settings, under Connectors, to turn it on.")
})
