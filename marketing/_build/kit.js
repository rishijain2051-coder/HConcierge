/* Deterministic animation helpers. Nothing reads the wall clock: every scene is
   a pure function of t, so the same t always produces the same pixels. */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

/* The product's one easing curve, cubic-bezier(.32,.72,0,1), solved properly
   rather than eyeballed — it is what every transition in the app uses. */
function bezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by
  const fx = (t) => ((ax * t + bx) * t + cx) * t
  const dfx = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    let t = x
    for (let i = 0; i < 8; i++) { const e = fx(t) - x; if (Math.abs(e) < 1e-6) break; const d = dfx(t); if (Math.abs(d) < 1e-6) break; t -= e / d }
    return ((ay * t + by) * t + cy) * t
  }
}
const glide = bezier(0.32, 0.72, 0, 1)

/** Linear 0..1 progress across a time window. */
const seg = (t, a, b) => clamp01((t - a) / (b - a))
/** Eased 0..1 progress across a time window. */
const ez = (t, a, b) => glide(seg(t, a, b))
/** Numeric interpolation across a window. */
const lerp = (t, a, b, from, to) => from + (to - from) * ez(t, a, b)

/**
 * Fade-and-rise in, then optionally out. Returns a style string.
 * rise is in px and follows the same curve the app uses for arriving cards.
 */
function inOut(t, { in: i, hold = 0.35, out, rise = 26 }) {
  const appear = ez(t, i, i + hold)
  const leave = out === undefined ? 0 : ez(t, out, out + hold)
  const opacity = appear * (1 - leave)
  const y = (1 - appear) * rise - leave * (rise * 0.5)
  return { opacity, transform: `translate3d(0,${y.toFixed(2)}px,0)` }
}
const apply = (el, s) => { for (const k in s) el.style[k] = s[k] }
/** Count up to a value, in whole numbers. */
const count = (t, a, b, to, from = 0) => Math.round(lerp(t, a, b, from, to))
