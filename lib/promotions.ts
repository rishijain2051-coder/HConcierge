import { sql } from './db'
import { audit } from './audit'
import { canManageProperty, type Ok } from './admin'
import { createFreeformRequest } from './requests'
import type { RoomContext } from './guest'
import { isUuid, scopeTo } from './scope'
import type { Staff } from './auth'
import { offerState, type Promotion, type PromotionKind, type GuestPromotion, type Room } from './types'
export { offerState, KIND_LABEL } from './types'
export type { Promotion, PromotionKind, GuestPromotion } from './types'

/**
 * What the hotel is offering, and what happens when a guest takes it up.
 *
 * This is not a discount engine and must not become one. HConcierge posts
 * charges and never settles them - there is no card, no payment and no
 * authority to reduce anybody's bill - so a promotion here does exactly what a
 * paper voucher in the room folder does: it says what is on offer, and when
 * the guest wants it the desk is told. The desk honours it at checkout.
 *
 * The one thing the paper cannot do is arithmetic. A spend threshold is read
 * against the room's own unsettled balance, so instead of "spend ₹2,000" the
 * concierge can say "₹740 to go" - and stop offering it once it is claimed.
 */

/** A stay's fingerprint, the same one lib/guest-session.ts binds a grant to. */
const stayOf = (room: Pick<Room, 'checked_in_at'>) =>
  room.checked_in_at ? new Date(room.checked_in_at).toISOString() : ''

/**
 * Everything on offer to this room, with the room's own balance and claims
 * already folded in. One round trip: the balance and the claim flags are
 * subqueries rather than three separate loads.
 */
export async function livePromotions(room: Room): Promise<GuestPromotion[]> {
  if (!room.occupied || !room.checked_in_at) return []
  const stay = stayOf(room)

  const rows = await sql<(Promotion & { claimed: boolean; balance: string })[]>`
    select p.id, p.title, p.description, p.kind, p.min_spend_paise, p.percent_off,
           p.department, p.fine_print, p.sort, p.active,
           exists (select 1 from promotion_claims c
                    where c.promotion_id = p.id and c.room_id = ${room.id} and c.stay = ${stay}) as claimed,
           coalesce((select sum(f.amount_paise)::text from folio_entries f
                      where f.room_id = ${room.id} and f.voided_at is null and f.settled_at is null), '0') as balance
      from promotions p
     where p.property_id = ${room.property_id} and p.active
     order by p.sort, p.title`

  return rows.map((r) => {
    const { available, shortBy } = offerState(r, Number(r.balance), r.claimed)
    return { ...r, claimed: r.claimed, short_by: available ? 0 : shortBy }
  })
}

/**
 * "I would like this one."
 *
 * Nothing is issued and nothing is discounted here. It records the claim
 * against the stay so it is only offered once, and puts the guest on the
 * desk's board with the offer named, which is the only way anybody actually
 * receives it.
 */
export async function claimPromotion(
  ctx: RoomContext,
  promotionId: string,
): Promise<{ ok: true; already?: boolean } | { ok: false; error: string }> {
  // Postgres answers a malformed uuid with an error, which surfaces as a 500.
  if (!isUuid(promotionId)) return { ok: false, error: 'That offer has ended.' }

  const [promo] = await sql<Promotion[]>`
    select id, title, description, kind, min_spend_paise, percent_off, department, fine_print, sort, active
      from promotions
     where id = ${promotionId} and property_id = ${ctx.property.id} and active`
  if (!promo) return { ok: false, error: 'That offer has ended.' }

  const stay = stayOf(ctx.room)
  if (!stay) return { ok: false, error: 'That offer has ended.' }

  const [bal] = await sql<{ total: string | null }[]>`
    select sum(amount_paise)::text as total from folio_entries
     where room_id = ${ctx.room.id} and voided_at is null and settled_at is null`

  // Re-checked here and not trusted from the phone: the threshold is the whole
  // agreement, and a screen that has been open since before dinner is stale.
  const { available, note } = offerState(promo, Number(bal?.total ?? 0), false)
  if (!available) return { ok: false, error: note }

  // The unique index is what makes this safe against a double tap, not the
  // read above: two taps a moment apart both saw "not claimed".
  const inserted = await sql<{ id: string }[]>`
    insert into promotion_claims (promotion_id, room_id, stay)
    values (${promo.id}, ${ctx.room.id}, ${stay})
    on conflict (promotion_id, room_id, stay) do nothing
    returning id`
  if (inserted.length === 0) return { ok: true, already: true }

  const res = await createFreeformRequest(
    ctx,
    `Would like to use an offer - ${promo.title}${promo.fine_print ? ` (${promo.fine_print})` : ''}`,
    promo.department ?? 'front_desk',
  )
  if (!res.ok) {
    // The request is what the desk actually sees. Without it the claim is a row
    // nobody reads, and the guest would be told yes and never given anything.
    await sql`delete from promotion_claims where id = ${inserted[0].id}`
    return res
  }

  await sql`update promotion_claims set request_id = ${res.id} where id = ${inserted[0].id}`
  await audit({
    propertyId: ctx.property.id,
    actor: `Room ${ctx.room.number}`,
    action: 'promotion.claimed',
    entity: 'promotion',
    entityId: promo.id,
    meta: { title: promo.title, room: ctx.room.number },
  })
  return { ok: true }
}

/* ------------------------------------------------------------------- admin */

const fail = (error: string) => ({ ok: false as const, error })

export async function listPromotions(actor: Staff, propertyId: string): Promise<Promotion[]> {
  return sql<Promotion[]>`
    select id, title, description, kind, min_spend_paise, percent_off, department, fine_print, sort, active
      from promotions
     where property_id = ${propertyId} and ${scopeTo(actor, sql`property_id`, propertyId)}
     order by sort, title`
}

export type PromotionInput = {
  id?: string | null
  title: string
  description: string
  kind: PromotionKind
  minSpendRupees: number
  percentOff: number | null
  department: string | null
  finePrint: string | null
  active: boolean
}

export async function savePromotion(
  actor: Staff,
  propertyId: string,
  input: PromotionInput,
): Promise<Ok> {
  if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')

  const title = input.title.trim().slice(0, 80)
  const description = input.description.trim().slice(0, 400)
  if (!title) return fail('Give the offer a name - that is what the guest reads first.')
  if (!description) return fail('Say what the guest actually gets.')

  const kind: PromotionKind = ['coupon', 'pass', 'discount'].includes(input.kind) ? input.kind : 'coupon'
  // Rupees on the way in, paise in the column: money is an integer everywhere
  // past this line, and a threshold of ₹2,000.5 is not a thing.
  const minSpend = Math.max(0, Math.round(Number(input.minSpendRupees) || 0)) * 100
  const percent = kind === 'discount' ? Math.min(100, Math.max(1, Math.round(Number(input.percentOff) || 0))) : null
  if (kind === 'discount' && !percent) return fail('A discount needs a percentage.')

  const department = input.department?.trim() || null
  const finePrint = input.finePrint?.trim().slice(0, 200) || null

  if (input.id) {
    await sql`
      update promotions
         set title = ${title}, description = ${description}, kind = ${kind},
             min_spend_paise = ${minSpend}, percent_off = ${percent},
             department = ${department}, fine_print = ${finePrint}, active = ${input.active}
       where id = ${input.id} and property_id = ${propertyId}`
  } else {
    const [{ next }] = await sql<{ next: number }[]>`
      select coalesce(max(sort), -1) + 1 as next from promotions where property_id = ${propertyId}`
    await sql`
      insert into promotions (property_id, title, description, kind, min_spend_paise,
                              percent_off, department, fine_print, sort, active)
      values (${propertyId}, ${title}, ${description}, ${kind}, ${minSpend},
              ${percent}, ${department}, ${finePrint}, ${next}, ${input.active})`
  }

  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: input.id ? 'promotion.updated' : 'promotion.created',
    entity: 'promotion',
    entityId: input.id ?? undefined,
    meta: { title },
  })
  return { ok: true }
}

export async function deletePromotion(actor: Staff, id: string): Promise<Ok> {
  const [row] = await sql<{ property_id: string; title: string }[]>`
    select property_id, title from promotions where id = ${id}`
  if (!row) return { ok: true }
  if (!(await canManageProperty(actor, row.property_id))) return fail('Not your property.')

  // Claims go with it. They are a record of who asked for what, and the
  // request each one raised is what the desk worked from - that survives.
  await sql`delete from promotions where id = ${id}`
  await audit({
    propertyId: row.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'promotion.deleted',
    entity: 'promotion',
    entityId: id,
    meta: { title: row.title },
  })
  return { ok: true }
}
