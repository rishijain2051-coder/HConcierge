import { renderScene } from './render.mjs'
const [scene, out, w, h, secs] = process.argv.slice(2)
console.log('  ' + out)
await renderScene({ scene, out, width: +w, height: +h, seconds: +secs })
