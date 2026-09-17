// A minimal Chrome DevTools Protocol client.
//
// No dependency: Node 24 ships a global WebSocket, and Chrome is already on
// this machine. Frames are driven by calling window.__render(t) explicitly
// rather than letting CSS animations run against the wall clock, so a render
// is deterministic and reproducible.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

export async function launch(port = 9333) {
  const profile = mkdtempSync(join(tmpdir(), 'hc-render-'))
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--allow-file-access-from-files',
  ], { stdio: 'ignore' })

  // Wait for the debugging endpoint rather than sleeping a fixed amount.
  let info
  for (let i = 0; i < 100; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break }
    catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  if (!info) { proc.kill(); throw new Error('Chrome did not expose a debugging port') }

  return { proc, info, port, cleanup: () => { try { proc.kill() } catch {} ; try { rmSync(profile, { recursive: true, force: true }) } catch {} } }
}

export async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')) })
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id)
      if (msg.error) rej(new Error(msg.error.message))
      else res(msg.result)
    } else listeners.forEach((f) => f(msg))
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params, sessionId })) })
  return { send, on: (f) => listeners.push(f), close: () => ws.close() }
}

/** Attach to a fresh tab sized exactly to the output, and return a session. */
export async function newPage(browser, width, height) {
  const cdp = await connect(browser.info.webSocketDebuggerUrl)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const S = (m, p) => cdp.send(m, p, sessionId)
  await S('Page.enable')
  await S('Runtime.enable')
  await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  return { S, cdp, targetId }
}

export async function load(page, fileUrl) {
  await page.S('Page.navigate', { url: fileUrl })
  // Wait for the document, the fonts and the scene's own signal.
  for (let i = 0; i < 300; i++) {
    const { result } = await page.S('Runtime.evaluate', {
      expression: `(document.readyState === 'complete' && !!window.__render && document.fonts.status === 'loaded')`,
      returnByValue: true,
    })
    if (result.value) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('scene never became ready: ' + fileUrl)
}

export async function frame(page, t) {
  await page.S('Runtime.evaluate', { expression: `window.__render(${t})`, awaitPromise: true })
  const { data } = await page.S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  return Buffer.from(data, 'base64')
}
