import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createClaudePrintCommand,
  createCopilotPromptCommand,
  createOpenCodeRunCommand
} from '@teammate/runtime-adapters'
import {
  BROWSER_PARTITION,
  browserRuntimeUnsupportedNote,
  classifyBrowserAction,
  formatBrowserPageSnapshot,
  supportsPerRunBrowserMcp
} from '../shared/browser.js'
import { resolveBrowserUrl } from './browser-url.js'
import { policyBrowserRefusal } from '../shared/organization-policy.js'
import { readOrganizationPolicy } from './organization-policy.js'

describe('the browser teammates can use', () => {
  it('uses an isolated persistent Chromium partition apart from the person’s Chrome', () => {
    expect(BROWSER_PARTITION).toBe('persist:locust-browser')
  })

  it('allows http, https, localhost, and file URLs inside the conversation’s folder, and refuses paths or symlinks outside it', () => {
    const root = mkdtempSync(join(tmpdir(), 'locust-browser-test-'))
    const outside = mkdtempSync(join(tmpdir(), 'locust-browser-outside-'))
    try {
      const workspaceDir = join(root, 'workspace')
      mkdirSync(workspaceDir, { recursive: true })
      const insideFile = join(workspaceDir, 'index.html')
      writeFileSync(insideFile, '<h1>Inside</h1>')
      const outsideFile = join(outside, 'secret.html')
      writeFileSync(outsideFile, '<h1>Outside</h1>')
      const realInsideFile = realpathSync(insideFile)

      expect(resolveBrowserUrl('https://example.com/docs', workspaceDir)).toEqual({
        ok: true,
        url: 'https://example.com/docs',
        origin: 'https://example.com'
      })
      expect(resolveBrowserUrl('localhost:3000/app', workspaceDir)).toEqual({
        ok: true,
        url: 'http://localhost:3000/app',
        origin: 'http://localhost:3000'
      })
      expect(resolveBrowserUrl('./index.html', workspaceDir)).toEqual({
        ok: true,
        url: pathToFileURL(realInsideFile).href,
        origin: 'file://workspace',
        filePath: realInsideFile
      })
      expect(resolveBrowserUrl(pathToFileURL(insideFile).href, workspaceDir)).toEqual({
        ok: true,
        url: pathToFileURL(realInsideFile).href,
        origin: 'file://workspace',
        filePath: realInsideFile
      })

      // Outside the conversation's folder is refused.
      expect(resolveBrowserUrl('../outside.html', workspaceDir).ok).toBe(false)
      expect(resolveBrowserUrl(pathToFileURL(outsideFile).href, workspaceDir).ok).toBe(false)
      expect(resolveBrowserUrl('javascript:alert(1)', workspaceDir).ok).toBe(false)
      expect(resolveBrowserUrl('data:text/html,hi', workspaceDir).ok).toBe(false)

      // A symlink or junction inside the workspace pointing outside it is refused via realpath.
      const linkPath = join(workspaceDir, 'escape-link.html')
      let linked = false
      try {
        symlinkSync(outsideFile, linkPath)
        linked = true
      } catch {
        // Windows without developer-mode symlink privilege may skip file symlink creation; test directory junction too.
      }
      if (linked) {
        expect(resolveBrowserUrl('./escape-link.html', workspaceDir).ok).toBe(false)
      }
      const junctionDir = join(workspaceDir, 'escape-dir')
      let junctionCreated = false
      try {
        symlinkSync(outside, junctionDir, 'junction')
        junctionCreated = true
      } catch {
        // Ignore if junction creation is restricted
      }
      if (junctionCreated) {
        expect(resolveBrowserUrl('./escape-dir/secret.html', workspaceDir).ok).toBe(false)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('asks first before credentials, form submission, purchases, sends, downloads, and leaving for an unopened site', () => {
    // 1. Typing into a password or payment field -> credential
    expect(
      classifyBrowserAction({
        action: 'type',
        currentUrl: 'https://example.com/login',
        element: {
          ref: '@e1',
          tag: 'input',
          role: 'textbox',
          name: 'Password',
          type: 'password',
          sensitive: true
        }
      })?.gate
    ).toBe('credential')

    expect(
      classifyBrowserAction({
        action: 'type',
        currentUrl: 'https://example.com/pay',
        element: {
          ref: '@e2',
          tag: 'input',
          role: 'textbox',
          name: 'Card number'
        }
      })?.gate
    ).toBe('credential')

    // Ordinary search field does not ask first
    expect(
      classifyBrowserAction({
        action: 'type',
        currentUrl: 'https://example.com',
        element: {
          ref: '@e3',
          tag: 'input',
          role: 'searchbox',
          name: 'Search documentation',
          type: 'search'
        }
      })
    ).toBeUndefined()

    // 2. Submitting a form -> submit
    expect(
      classifyBrowserAction({
        action: 'click',
        currentUrl: 'https://example.com/login',
        element: {
          ref: '@e4',
          tag: 'button',
          role: 'button',
          name: 'Sign in',
          type: 'submit',
          submit: true
        }
      })?.gate
    ).toBe('submit')

    // 3. Purchase or checkout -> purchase
    expect(
      classifyBrowserAction({
        action: 'click',
        currentUrl: 'https://shop.example.com/cart',
        element: {
          ref: '@e5',
          tag: 'button',
          role: 'button',
          name: 'Place order'
        }
      })?.gate
    ).toBe('purchase')

    // 4. Sending or posting -> send
    expect(
      classifyBrowserAction({
        action: 'click',
        currentUrl: 'https://mail.example.com/compose',
        element: {
          ref: '@e6',
          tag: 'button',
          role: 'button',
          name: 'Send message'
        }
      })?.gate
    ).toBe('send')

    // 5. Download -> download
    expect(
      classifyBrowserAction({
        action: 'download',
        currentUrl: 'https://example.com/releases',
        filename: 'report.csv'
      })?.gate
    ).toBe('download')

    // 6. Leaving for a site the person has not opened in that tab -> leave-origin
    expect(
      classifyBrowserAction({
        action: 'open',
        currentUrl: 'https://example.com/home',
        targetUrl: 'https://other-site.org/page',
        personOrigins: new Set(['https://example.com'])
      })?.gate
    ).toBe('leave-origin')

    // Staying on an already-trusted origin does not ask first
    expect(
      classifyBrowserAction({
        action: 'open',
        currentUrl: 'https://example.com/home',
        targetUrl: 'https://example.com/docs',
        personOrigins: new Set(['https://example.com'])
      })
    ).toBeUndefined()
  })

  it('formats bounded accessibility snapshots with @eN references for teammate read calls', () => {
    const text = formatBrowserPageSnapshot({
      tabId: 'tab-1',
      url: 'https://example.com',
      title: 'Example Page',
      text: 'Welcome to Example Page.',
      elements: [
        { ref: '@e1', role: 'link', tag: 'a', name: 'More information', href: 'https://example.com/more' },
        { ref: '@e2', role: 'textbox', tag: 'input', name: 'Email', type: 'email', submit: true }
      ]
    })
    expect(text).toContain('Title: Example Page')
    expect(text).toContain('URL: https://example.com')
    expect(text).toContain('[ref=@e1] link "More information" -> https://example.com/more')
    expect(text).toContain('[ref=@e2] textbox "Email" type=email submits-form')
  })

  it('wires per-run browser MCP config into Claude, OpenCode, and Copilot commands and names runtimes that lack per-run MCP', () => {
    expect(supportsPerRunBrowserMcp('claude')).toBe(true)
    expect(supportsPerRunBrowserMcp('codex')).toBe(true)
    expect(supportsPerRunBrowserMcp('opencode')).toBe(true)
    expect(supportsPerRunBrowserMcp('copilot')).toBe(true)
    expect(supportsPerRunBrowserMcp('acp')).toBe(true)
    expect(supportsPerRunBrowserMcp('cursor')).toBe(false)
    expect(browserRuntimeUnsupportedNote('cursor')).toContain('Cursor Agent')

    const browserMcp = {
      configPath: '/tmp/locust-browser-mcp.json',
      command: '/usr/local/bin/node',
      args: ['/app/resources/locust-browser-bridge.mjs'],
      env: {
        LOCUST_BROWSER_URL: 'http://127.0.0.1:54321/browser/call',
        LOCUST_BROWSER_TOKEN: 'tok-123',
        ELECTRON_RUN_AS_NODE: '1'
      }
    }

    const claudeSpec = createClaudePrintCommand(
      { commandName: 'claude', discoveredPath: 'claude', executablePath: 'claude', prefixArgs: [], kind: 'native' },
      {
        prompt: 'Open localhost',
        workspacePath: '/tmp',
        sandbox: 'workspace-write',
        browserMcp
      }
    )
    expect(claudeSpec.args).toContain('--mcp-config')
    expect(claudeSpec.args).toContain('/tmp/locust-browser-mcp.json')

    const opencodeSpec = createOpenCodeRunCommand(
      { commandName: 'opencode', discoveredPath: 'opencode', executablePath: 'opencode', prefixArgs: [], kind: 'native' },
      {
        prompt: 'Open localhost',
        workspacePath: '/tmp',
        sandbox: 'workspace-write',
        browserMcp
      }
    )
    expect(JSON.parse(opencodeSpec.env?.OPENCODE_CONFIG_CONTENT ?? '{}')).toHaveProperty('mcp.locust_browser')

    const copilotSpec = createCopilotPromptCommand(
      { commandName: 'copilot', discoveredPath: 'copilot', executablePath: 'copilot', prefixArgs: [], kind: 'native' },
      {
        prompt: 'Open localhost',
        workspacePath: '/tmp',
        sandbox: 'workspace-write',
        browserMcp
      }
    )
    expect(copilotSpec.args).toContain('--additional-mcp-config')
    expect(copilotSpec.args).toContain('@/tmp/locust-browser-mcp.json')
  })

  it('honors organization policy browser: false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'locust-org-browser-'))
    try {
      const policyPath = join(dir, 'policy.json')
      writeFileSync(policyPath, JSON.stringify({ browser: false }))
      const loaded = readOrganizationPolicy({ packaged: false, env: { LOCUST_POLICY_FILE: policyPath } })
      expect(loaded.policy.browser).toBe(false)
      expect(policyBrowserRefusal(loaded)).toContain('The browser panel is off. Set by your organization')
      expect(policyBrowserRefusal(undefined)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
