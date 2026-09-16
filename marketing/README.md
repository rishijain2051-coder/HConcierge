# Marketing video

Five films, rendered from HTML. Nothing here is installed into the app: the
pipeline uses the Chrome already on this machine plus `ffmpeg`, driven over the
DevTools Protocol with Node's built-in `WebSocket`. `package.json` is untouched.

| # | File | Ratio | Length | What it argues |
|---|------|-------|--------|----------------|
| 1 | `out/01-2am-vertical.mp4` | 9:16 | 16s | The room phone is the thing being replaced |
| 2 | `out/02-fanout-vertical.mp4` | 9:16 | 15s | One basket becomes one request per team |
| 3 | `out/03-escalation-wide.mp4` | 16:9 | 24s | A late request escalates itself — the differentiator |
| 4 | `out/04-setup-wide.mp4` | 16:9 | 22s | Three steps, no app and no hardware |
| 5 | `out/05-loop-wide.mp4` | 16:9 | 28s | Card on the desk to bill at checkout |

All five are silent and caption-first, because social autoplays muted. They end
on the same card, so they read as a set.

## What the copy is allowed to say

`PRODUCT.md` forbids claiming a live installation, naming the trial client as a
customer, or quoting any measured result, since none has been measured. So these
films argue the *mechanism* — routing, target times, self-escalation — and never
show a metric, a testimonial or a client logo. The hotel is deliberately
unnamed; only room numbers appear.

Menu names, prices and target times are the real rows from the directory, used
the same way `app/DemoStage.tsx` uses them on the landing page: as a
demonstration, not as evidence of a deployment.

The four-digit code shown in film 5 is `2719`, an invention. Do not replace it
with a real room code.

## Re-rendering

Each film is one self-contained HTML file in `_build/`. A scene exposes
`window.__render(t)` and is a pure function of `t` — no CSS animation runs
against the wall clock — so a render is deterministic and a re-render of
unchanged copy produces identical bytes.

```bash
cd marketing/_build
node _render.mjs v3-escalation.html ../out/03-escalation-wide.mp4 1920 1080 24
```

Arguments are `scene output width height seconds`, at 30fps. Editing copy means
editing the HTML; the timeline lives in the `__render` function at the bottom of
each file, in seconds.

`kit.css` carries the design tokens copied from `app/globals.css`, and `kit.js`
has the easing — `cubic-bezier(.32,.72,0,1)`, solved numerically rather than
approximated, so motion matches the product.

## Brand

`brand/logo-mark.svg` is the square mark, `brand/logo-lockup.svg` the mark plus
wordmark, `brand/logo-lockup-invert.svg` for dark backgrounds. The mark is drawn
geometrically rather than typeset, so it survives a favicon without shipping a
font. Its crossbar is a target-time track, partly filled — the one idea the
product is about, at 16px.

The lockups set the wordmark in Instrument Sans, which the app loads via
`next/font`. For a context without that font, use the mark alone.

## Not in git

These are build outputs and binaries. They are untracked on purpose — add
`marketing/out/` to `.gitignore` if you would rather not see them in
`git status`, or move the whole folder outside the repo.
