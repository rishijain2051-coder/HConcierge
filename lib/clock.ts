/**
 * The hotel's clock.
 *
 * A scheduled time means one thing only: the wall clock in the building the
 * guest is standing in. Their phone is often still on home time, and a
 * serverless region has no opinion at all - so `properties.timezone` is the
 * single source of truth for one, on the way in and on the way back out.
 *
 * `<input type="datetime-local">` carries no offset, which is exactly right
 * here: the string stays a bare wall clock the whole way, and the property's
 * zone is what turns it into an instant (in Postgres, which owns the tz
 * database - see lib/requests.ts).
 */

/** A `datetime-local` value: "2026-09-17T07:00". No offset, hotel wall clock. */
export function isWallClock(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false
  // The shape is not the date. Postgres raises on '2026-02-31' rather than
  // rolling it over, and a 500 is not a validation message - so round-trip it.
  const parsed = new Date(`${value}:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

/**
 * Now, as a `datetime-local` value in `timeZone` - what the lobby clock says.
 *
 * Built from parts rather than a locale string: this feeds an `<input min>`,
 * which accepts one format and silently ignores anything else.
 */
export function wallClockNow(timeZone: string, at: Date = new Date()): string {
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23', // not hour12:false - some ICU builds render midnight as 24
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)) {
    p[part.type] = part.value
  }
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/**
 * "17 Sept, 7:00 am" on the hotel's clock, whatever the reader's own says.
 *
 * The locale is pinned, like `rupees()` pins it. Not taste: this renders
 * inside a client component that is server-rendered too, and Node's default
 * locale is not the phone's - the default would produce "Sep 17, 7:00 AM" in
 * the HTML and "17 Sept, 7:00 am" at hydration for a guest on en-GB, and
 * React discards the tree over a text mismatch.
 */
export function hotelTime(at: string | Date, timeZone: string): string {
  return new Date(at).toLocaleString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    timeZone,
  })
}

/**
 * Scheduling reads `properties.timezone` now, so a typo in that column is a
 * wake-up call nobody gets - and a crash on the board that renders it.
 */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}
