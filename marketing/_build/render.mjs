import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { launch, newPage, load, frame } from './cdp.mjs'

export async function renderScene({ scene, out, width, height, seconds, fps = 30 }) {
  const total = Math.round(seconds * fps)
  const browser = await launch()
  const t0 = Date.now()
  try {
    const page = await newPage(browser, width, height)
    await load(page, pathToFileURL(resolve(scene)).href)

    const ff = spawn('ffmpeg', [
      '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      resolve(out),
    ], { stdio: ['pipe', 'ignore', 'pipe'] })
    let ffErr = ''
    ff.stderr.on('data', (d) => { ffErr += d })
    const done = new Promise((res, rej) =>
      ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + '\n' + ffErr.slice(-1500))))))

    for (let f = 0; f < total; f++) {
      const png = await frame(page, f / fps)
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r))
      if (f % 60 === 0) process.stdout.write(`\r    ${f}/${total} frames`)
    }
    ff.stdin.end()
    await done
    process.stdout.write(`\r    ${total}/${total} frames — ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  } finally {
    browser.cleanup()
  }
}

/** One-off still, for checking a design without rendering a whole video. */
export async function still({ scene, out, width, height, t = 0 }) {
  const browser = await launch()
  try {
    const page = await newPage(browser, width, height)
    await load(page, pathToFileURL(resolve(scene)).href)
    const png = await frame(page, t)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(resolve(out), png)
  } finally { browser.cleanup() }
}
