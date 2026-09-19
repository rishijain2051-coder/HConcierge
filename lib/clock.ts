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
 * A bare wall clock, in words: "Sun, 21 Sept, 11:00 am".
 *
 * Not hotelTime. That one takes an instant and renders it in a zone, which is
 * right for a `timestamptz` off the database and wrong here - a datetime-local
 * string is *already* the hotel's clock, so `new Date("...T11:00")` would read
 * it in the reader's zone first and hotelTime would then convert an hour that
 * was never in any zone at all. Parsed as UTC and rendered as UTC, the two
 * cancel and the string comes back exactly as it was chosen.
 */
export function wallClockLabel(value: string): string {
  return new Date(`${value}:00Z`).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
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

/** "07:00" as a guest reads it. Pinned locale, for the reason hotelTime is. */
const clockLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

const nextDay = (day: string) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)

/**
 * The times somebody actually asks for, on the hotel's clock.
 *
 * A bare `datetime-local` is four taps and a keyboard for "seven tomorrow",
 * which is the answer most of the time - so the answer most of the time is one
 * tap, and the input stays underneath for everything else. Every candidate is
 * compared as a wall-clock string, which sorts correctly by construction and
 * never builds a Date in the phone's own zone by accident.
 */
export function timeSuggestions(timezone: string, now: Date = new Date()) {
  const nowWall = wallClockNow(timezone, now)
  const today = nowWall.slice(0, 10)
  const out = [{ label: 'In an hour', value: wallClockNow(timezone, new Date(now.getTime() + 3_600_000)) }]

  for (const hhmm of ['07:00', '08:00', '09:00']) {
    const sameDay = `${today}T${hhmm}`
    const value = sameDay > nowWall ? sameDay : `${nextDay(today)}T${hhmm}`
    out.push({ label: `${value.startsWith(today) ? 'Today' : 'Tomorrow'} ${clockLabel(hhmm)}`, value })
  }
  return out
}
