'use client'

import { useEffect, useState } from 'react'

import { wallClockLabel, wallClockNow } from '@/lib/clock'
import { IconClose } from '@/components/icons'

/** Small shared pieces for the staff screens. Six of them need the same modal,
 *  the same field and the same destructive-confirm, so they live here rather
 *  than being reimplemented per screen - which is how Rooms ended up with a
 *  modal that did not lock the page behind it. */

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[clamp(1.6rem,3vw,2rem)] leading-[1.1] tracking-[-0.02em]">{title}</h1>
          {description && <p className="text-muted mt-1.5 max-w-[70ch] text-[14px]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Button({
  children,
  onClick,
  variant = 'quiet',
  disabled,
  type = 'button',
  full,
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'quiet' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  full?: boolean
}) {
  const cls =
    variant === 'primary'
      ? 'bg-ink border-ink text-white hover:opacity-90'
      : variant === 'danger'
        ? 'border-line text-late hover:bg-late-soft'
        : 'border-line text-muted hover:text-ink'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 sm:min-h-0 ${cls} ${
        full ? 'w-full py-2.5 text-[14px]' : ''
      }`}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = 'text',
  hint,
  required,
  autoFocus,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  name: string
  defaultValue?: string | number
  placeholder?: string
  type?: string
  hint?: string
  required?: boolean
  autoFocus?: boolean
  min?: number
  max?: number
  step?: string
  /**
   * Controlled, for the handful of fields something else has to read as it is
   * typed - a confirmation that gates a button, rather than a value a form
   * submit collects. Both optional, so every existing uncontrolled caller is
   * untouched. `Select` already worked this way.
   */
  value?: string
  onChange?: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <input
        name={name}
        type={type}
        {...(onChange ? { value: value ?? '', onChange: (e) => onChange(e.target.value) } : { defaultValue })}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        min={min}
        max={max}
        step={step}
        className="border-line bg-surface focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none transition-colors"
      />
      {hint && <span className="text-faint mt-1 block text-[11px]">{hint}</span>}
    </label>
  )
}

/**
 * A date and a time, for the two places the desk sets one.
 *
 * A bare `datetime-local` is a dd/mm/yyyy stub and a blinking cursor, which is
 * four fields of typing for "out on Sunday" - the answer nearly every time. So
 * the nights are buttons and the date reads back in words underneath, and the
 * native input stays for the stay that ends at six in the morning.
 *
 * Eleven is the hour because it is checkout at almost every hotel; a property
 * that turns rooms at noon takes one more tap on the input below. And the
 * whole thing is computed on the property's clock rather than the reception
 * laptop's, which on a group account is showing one city while the desk is
 * standing in another.
 */
export function DateTimeField({
  label,
  name,
  timezone,
  defaultValue,
  hint,
  hour = 11,
}: {
  label: string
  name: string
  timezone: string
  /** An instant from the database, or nothing. Rendered on the hotel's clock. */
  defaultValue?: string | null
  hint?: string
  hour?: number
}) {
  const [value, setValue] = useState(() => (defaultValue ? wallClockNow(timezone, new Date(defaultValue)) : ''))
  // Read once on mount: these live inside modals that open on a click, so
  // there is no server HTML to disagree with, and the row of nights should not
  // renumber itself while somebody is looking at it.
  const [today] = useState(() => wallClockNow(timezone).slice(0, 10))

  const nights = [1, 2, 3, 7].map((n) => ({
    n,
    value: `${new Date(new Date(`${today}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`,
  }))

  return (
    <div className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {nights.map((o) => {
          const on = value === o.value
          return (
            <button
              key={o.n}
              type="button"
              onClick={() => setValue(on ? '' : o.value)}
              aria-pressed={on}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition ${
                on ? 'bg-ink border-ink text-white' : 'border-line text-muted hover:border-ink hover:text-ink'
              }`}
            >
              {o.n === 1 ? '1 night' : `${o.n} nights`}
            </button>
          )
        })}
        {value && (
          <button
            type="button"
            onClick={() => setValue('')}
            className="text-faint hover:text-ink px-2 py-1.5 text-[13px] font-medium transition"
          >
            Clear
          </button>
        )}
      </div>

      <input
        name={name}
        type="datetime-local"
        value={value}
        // A bare date is not a valid floor for this input and is silently
        // ignored; it has to carry an hour to hold at all.
        min={`${today}T00:00`}
        onChange={(e) => setValue(e.target.value)}
        className="border-line bg-surface focus:border-ink w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none transition-colors"
      />

      {/* The input renders the date in whatever order the reception laptop's
          locale puts it, and 09/11 is two different days on two machines. This
          line is the one unambiguous reading of what was chosen. */}
      <span className="mt-1.5 block text-[12px]">
        {value ? (
          <span className="text-ink font-medium">
            Out on {wallClockLabel(value)}
          </span>
        ) : (
          <span className="text-faint">{hint ?? 'Open-ended. Set it later from the room.'}</span>
        )}
      </span>
    </div>
  )
}

export function TextArea({
  label,
  name,
  defaultValue,
  rows = 8,
  hint,
}: {
  label: string
  name: string
  defaultValue?: string
  rows?: number
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="border-line bg-surface focus:border-ink w-full resize-y rounded-xl border px-3.5 py-2.5 text-[14px] leading-relaxed outline-none transition-colors"
      />
      {hint && <span className="text-faint mt-1 block text-[11px]">{hint}</span>}
    </label>
  )
}

export function Select({
  label,
  name,
  defaultValue,
  options,
  hint,
  onChange,
}: {
  label: string
  name: string
  defaultValue?: string
  options: { value: string; label: string }[]
  hint?: string
  onChange?: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="border-line bg-surface focus:border-ink w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none transition-colors"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-faint mt-1 block text-[11px]">{hint}</span>}
    </label>
  )
}

export function Check({
  label,
  name,
  value,
  defaultChecked,
}: {
  label: string
  name: string
  /** Needed when several checkboxes share a name and the form reads getAll. */
  value?: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="accent-ink h-4 w-4 rounded"
      />
      <span className="text-[14px]">{label}</span>
    </label>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div
        className="bg-scrim absolute inset-0"
        style={{ animation: 'hc-fade-in 240ms var(--ease-glide) both' }}
        onClick={onClose}
      />
      <div
        className={`bg-surface relative max-h-[88dvh] w-full overflow-y-auto rounded-2xl p-5 shadow-[var(--shadow-lift)] ${
          wide ? 'max-w-xl' : 'max-w-sm'
        }`}
        style={{ animation: 'hc-sheet-in 380ms var(--ease-glide) both' }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-faint hover:text-ink -mt-1.5 -mr-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-90"
          >
            <IconClose size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Err({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="bg-late-soft text-late rounded-xl px-3.5 py-2.5 text-[13px]">
      {children}
    </p>
  )
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'late' }) {
  const cls =
    tone === 'ok'
      ? 'bg-ok-soft text-ok'
      : tone === 'warn'
        ? 'bg-warn-soft text-warn'
        : tone === 'late'
          ? 'bg-late-soft text-late'
          : 'bg-paper text-muted'
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

/**
 * Shown once after a create or a reset. The password is never stored in the
 * clear, so if this is dismissed without copying it the only way forward is
 * another reset - which the copy says plainly.
 */
export function PasswordOnce({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal title="One-time password" onClose={onClose}>
      <p className="text-muted text-[14px] leading-relaxed">
        Give this to <span className="text-ink font-semibold">{username}</span>. It is shown once and cannot be read
        back - if it is lost, issue another. They can set their own under Password once they are in.
      </p>
      <div className="border-line bg-paper mt-4 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3">
        <code className="text-[17px] font-semibold tracking-wide tabular-nums select-all">{password}</code>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-faint mt-3 text-[12px] leading-relaxed">
        This is the only time it is shown. Nothing stores it in readable form - if you lose it, reset the password
        again.
      </p>
      <div className="mt-4">
        <Button variant="primary" full onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}

/** A named confirmation, so a misclick cannot delete a section of the menu. */
export function Confirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-muted text-[14px] leading-relaxed">{body}</p>
      <div className="mt-5 flex gap-2">
        <Button full onClick={onClose}>
          Keep it
        </Button>
        <Button
          full
          variant="danger"
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
