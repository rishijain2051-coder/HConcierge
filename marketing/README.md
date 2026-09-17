# Marketing video

Six films, rendered from HTML. Nothing here is installed into the app: the
pipeline uses the Chrome already on this machine plus `ffmpeg`, driven over the
DevTools Protocol with Node's built-in `WebSocket`. `package.json` is untouched.

| # | Scene | Ratios | Length | What it argues |
|---|-------|--------|--------|----------------|
| 1 | `v1-2am` | 9:16 | 16s | The room phone is the thing being replaced |
| 2 | `v2-fanout` | 9:16 | 15s | One basket becomes one request per team |
| 3 | `v3-escalation` | 16:9 · 9:16 | 24s | A late request escalates itself — the differentiator |
| 4 | `v4-setup` | 16:9 · 9:16 | 22s | Three steps, no app and no hardware |
| 5 | `v5-loop` | 16:9 · 9:16 | 28s | Card on the desk to bill at checkout |
| 6 | `v6-tour` | 16:9 | 7m57s | The walkthrough — all 88 features, one at a time |

Nine files in `out/`: `NN-name-wide.mp4` at 1920×1080 and `NN-name-vertical.mp4`
at 1080×1920. Films 1 and 2 were written vertical and have no wide cut; film 6
is a sit-down walkthrough and has no vertical cut.

Films 1 to 5 are silent and caption-first, because social autoplays muted, and
they end on the same card so they read as a set.

## Film 6, the walkthrough

Seven chapters, eighty-eight features, in the order somebody would actually be
shown the product: the card and the code, what the guest can do, the board, the
front desk, what happens when something runs late, history and money, and
setting it up. Left column lists the features five to a page; the right column
mocks the screen being described and stays in step with it.

There is no hand-placed beat in it. Everything comes off the `CHAPTERS` array
at the bottom of `v6-tour.html`, which is the only way eighty-eight claims stay
true as the product moves — **the list is the spec, so a feature that changes
is edited in one place**. Timing falls out of `BEAT` (4.9s a feature) and
`INTRO` (3.4s a chapter); changing either re-times the whole film.

Two rules for editing it:

- Every line is read off the source, not off a pitch. The escalation message in
  chapter five is what `lib/notify.ts` actually sends, word for word.
- No performance numbers. The History mock shows counts and the demo
  property's own figures, never a hit rate — `PRODUCT.md` forbids quoting a
  measured result, and none has been measured.

**The HConcierge platform console is deliberately not in it.** The film is the
hotel's product; onboarding an organisation is not a hotelier's screen.

## One scene, two shapes

Films 3, 4 and 5 are a single HTML file each that renders at either size. The
layout that only works on a wide stage is fenced behind
`@media (max-aspect-ratio: 1/1)`, so rendering at 1080×1920 restacks it: the
three denials in film 3 become a column, the four counters in film 4 become two
by two, and the pair of team cards in film 5 sit one above the other. Nothing
is cropped and no copy is cut — the words are identical in both cuts, which is
the point of not keeping a second file per ratio.

Two things to know before editing them:

- An inline `style=` beats any selector, so a value the vertical cut needs to
  change has to live in the stylesheet, not on the element.
- `apply()` sets a transform every frame, and a transformed element becomes the
  containing block for everything absolute inside it. `#journey` in film 5 is
  0px tall for that reason — every child of it is absolutely positioned — so
  `top` works there and `bottom` silently resolves against nothing. It is given
  `position:absolute;inset:0` to make it a real box.

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
cd marketing/_build && node _render.mjs v3-escalation.html ../out/03-escalation-wide.mp4 1920 1080 24
```

```bash
cd marketing/_build && node _render.mjs v3-escalation.html ../out/03-escalation-vertical.mp4 1080 1920 24
```

The walkthrough is the same command with its own length, which it computes for
itself — read it off `window.__total` rather than counting chapters by hand:

```bash
cd marketing/_build && node _render.mjs v6-tour.html ../out/06-tour-wide.mp4 1920 1080 477.0
```

Arguments are `scene output width height seconds`, at 30fps — the same scene,
the size being the only difference between a wide cut and a vertical one.
Editing copy means editing the HTML; the timeline lives in the `__render`
function at the bottom of each file, in seconds.

`render.mjs` also exports `still({ scene, out, width, height, t })`, which is
how to check a layout at one moment without paying for a whole render.

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

`marketing/out/` is in `.gitignore`. The MP4s are build outputs: the scenes are
the source, and every file in `out/` rebuilds from them — the five short ones in
about four minutes, the walkthrough in about fifteen.
