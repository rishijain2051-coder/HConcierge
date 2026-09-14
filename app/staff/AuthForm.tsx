'use client'

import { useActionState } from 'react'
import type { FormState } from './login/actions'

type Field = {
  name: string
  label: string
  type: 'text' | 'password'
  autoComplete?: string
  autoFocus?: boolean
  hint?: string
}

export default function AuthForm({
  action,
  title,
  subtitle,
  submitLabel,
  fields,
  footer,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>
  title: string
  subtitle: string
  submitLabel: string
  fields: Field[]
  footer?: string
}) {
  const [state, formAction, pending] = useActionState(action, {})

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <p className="text-muted text-[11px] font-semibold tracking-[0.16em] uppercase">RN Hospitality</p>
      <h1 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight">{title}</h1>
      <p className="text-muted mt-1.5 text-sm">{subtitle}</p>

      <form action={formAction} className="mt-7 space-y-4">
        {fields.map((f) => (
          <div key={f.name}>
            <label htmlFor={f.name} className="mb-1.5 block text-[13px] font-medium">
              {f.label}
            </label>
            <input
              id={f.name}
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              autoFocus={f.autoFocus}
              required
              className="border-line bg-surface focus:border-ink w-full rounded-xl border px-3.5 py-3 text-[15px] outline-none"
            />
            {f.hint && <p className="text-faint mt-1 text-xs">{f.hint}</p>}
          </div>
        ))}

        {state.error && (
          <p role="alert" className="bg-late-soft text-late rounded-xl px-3.5 py-2.5 text-[13px]">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-ink w-full rounded-xl px-4 py-3 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Just a moment…' : submitLabel}
        </button>
      </form>

      {footer && <p className="text-faint mt-6 text-center text-xs leading-relaxed">{footer}</p>}
    </main>
  )
}
