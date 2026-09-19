'use client'

/**
 * One line of the hotel's directory, and the counter that sits on the end of
 * it.
 *
 * Pulled out of GuestApp so the Concierge panel can list the same items the
 * menu tabs do. A guest who taps "Extra towels" through the concierge and a
 * guest who finds it under Services are looking at one row with one set of
 * rules about price, availability and what "add" means - rather than at two
 * that drifted apart the first time either was edited.
 */

import { rupees } from '@/lib/money'
import type { Item } from '@/lib/types'
import { IconMinus, IconPlus } from '@/components/icons'

/** A plain item can be counted from the row. One with choices has to be opened. */
export const isSimple = (item: Item) => !item.modifier_groups?.length && !item.needs_time

export default function ItemRow({
  item,
  qty,
  onTap,
  onBump,
}: {
  item: Item
  qty: number
  onTap: (i: Item) => void
  onBump: (i: Item, by: number) => void
}) {
  return (
    <div className={`flex items-start justify-between gap-4 py-4 ${item.available ? '' : 'opacity-40'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.veg !== null && (
            <span
              aria-label={item.veg ? 'Vegetarian' : 'Non-vegetarian'}
              className={`inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${
                item.veg ? 'border-ok' : 'border-late'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${item.veg ? 'bg-ok' : 'bg-late'}`} />
            </span>
          )}
          <p className="text-[15px] leading-snug font-medium">{item.name}</p>
        </div>
        {item.description && <p className="text-muted mt-1 line-clamp-1 text-[13px]">{item.description}</p>}
        <p className="text-faint mt-1.5 text-xs">
          {item.price_paise > 0 ? (
            <span className="text-ink font-semibold tabular-nums">
              {rupees(item.price_paise)}
              {item.unit ? ` ${item.unit}` : ''}
            </span>
          ) : (
            'Complimentary'
          )}
          <span> · about {item.sla_minutes} min</span>
        </p>
      </div>

      <div className="mt-0.5 shrink-0">
        {!item.available ? (
          <span className="text-faint px-1 text-[12px] font-medium">Unavailable</span>
        ) : isSimple(item) ? (
          <Stepper qty={qty} onAdd={() => onBump(item, 1)} onSub={() => onBump(item, -1)} label={item.name} />
        ) : (
          /* Its siblings announce as "Add Idli Sambar"; this announced as
             "Choose", identically for every item with options. The label is
             only set while it is a bare verb: once it reads "Add · 2 in
             basket" the visible text has to stay the accessible name, per
             WCAG 2.5.3 Label in Name. */
          <button
            onClick={() => onTap(item)}
            aria-label={qty > 0 ? undefined : `${item.modifier_groups?.length ? 'Choose' : 'Add'} ${item.name}`}
            className="brand-text brand-border ease-glide rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition duration-300 active:scale-[0.96]"
          >
            {qty > 0 ? `Add · ${qty} in basket` : item.modifier_groups?.length ? 'Choose' : 'Add'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Counting up in place.
 *
 * At zero this is a single "＋" the width of a thumb. Tap it and it grows into
 * a counter, which is the whole point: you never have to open the basket to
 * find out what you already asked for.
 */
export function Stepper({
  qty,
  onAdd,
  onSub,
  label,
}: {
  qty: number
  onAdd: () => void
  onSub: () => void
  label: string
}) {
  if (qty === 0) {
    return (
      <button
        onClick={onAdd}
        aria-label={`Add ${label}`}
        className="brand-border brand-text ease-glide grid h-9 w-9 place-items-center rounded-full border transition duration-300 active:scale-[0.92]"
      >
        <IconPlus size={16} />
      </button>
    )
  }

  return (
    <div className="brand-bg ease-glide flex items-center rounded-full p-0.5 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] transition duration-300">
      <button
        onClick={onSub}
        aria-label={`One fewer ${label}`}
        className="ease-glide grid h-8 w-8 place-items-center rounded-full transition duration-200 active:scale-90"
      >
        <IconMinus size={15} />
      </button>
      <span className="min-w-5 text-center text-[14px] font-bold tabular-nums">{qty}</span>
      <button
        onClick={onAdd}
        aria-label={`One more ${label}`}
        className="ease-glide grid h-8 w-8 place-items-center rounded-full transition duration-200 active:scale-90"
      >
        <IconPlus size={15} />
      </button>
    </div>
  )
}
