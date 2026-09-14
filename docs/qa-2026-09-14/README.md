# Testing pass — 14 September 2026

Four agents drove the app in parallel, each with its own rooms and accounts so
their writes could not collide:

| file | scope |
|---|---|
| [guest-app.md](guest-app.md) | the whole guest flow on a phone and a tablet: code gate, ordering, steppers, basket, bill, settling, chat |
| [staff-screens.md](staff-screens.md) | board, rooms, history, check-in/out, settling, the live channel in both directions |
| [admin-and-tenancy.md](admin-and-tenancy.md) | the admin panel, the role matrix, and multi-tenant isolation |
| [realtime-and-api.md](realtime-and-api.md) | the push channels, every API route, auth boundaries, rate limits, connection health |

They are kept because the reproductions are worth more than the summaries, and
because each one ends with a **Verified working** list — which is the part you
want when something resurfaces and you need to know whether it ever worked.

Everything they classified blocker or major is fixed, across commits `fc81824`,
`ecda2af` and `d0c4a80`. What is left is in [`../../WHATS-LEFT.md`](../../WHATS-LEFT.md).

Two caveats on reading them:

- The admin agent's browser access was refused, so it drove the panel over HTTP
  by extracting server-action ids from the built chunks. Its findings are real
  HTTP reproductions; its responsive-layout coverage is nil.
- The guest agent ran while another session was editing `actions.ts` and
  `use-live.ts`. Its findings describe the build that was running at the time.
