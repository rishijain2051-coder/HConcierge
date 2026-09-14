export type AppliesTo = 'unaccepted' | 'unfinished' | 'any'

export const APPLIES_TO_LABEL: Record<AppliesTo, string> = {
  unaccepted: 'only if nobody has picked it up',
  unfinished: 'only if someone picked it up but has not finished',
  any: 'whether or not someone picked it up',
}

export type RuleStaff = { id: string; name: string; phone: string | null }

export type EscalationRule = {
  id: string
  property_id: string
  department: string | null
  step: number
  after_minutes: number
  applies_to: AppliesTo
  notify_managers: boolean
  notify_admins: boolean
  active: boolean
  staff: RuleStaff[]
}

export type EscalationInput = {
  id?: string | null
  department: string | null
  afterMinutes: number
  appliesTo: AppliesTo
  notifyManagers: boolean
  notifyAdmins: boolean
  active: boolean
  staffIds: string[]
}

export type Department = 'front_desk' | 'housekeeping' | 'fnb' | 'maintenance' | 'all'
export type Role = 'platform' | 'admin' | 'manager' | 'staff'

export const DEPARTMENTS: { value: Exclude<Department, 'all'>; label: string }[] = [
  { value: 'front_desk', label: 'Front desk' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'fnb', label: 'Food & beverage' },
  { value: 'maintenance', label: 'Maintenance' },
]

export function departmentLabel(d: string): string {
  return DEPARTMENTS.find((x) => x.value === d)?.label ?? (d === 'all' ? 'All departments' : d)
}

export type CategoryKind = 'amenity' | 'fnb' | 'service' | 'front_desk'
export type RequestKind = 'order' | 'amenity' | 'service' | 'front_desk' | 'other'
export type RequestStatus = 'new' | 'ack' | 'in_progress' | 'done' | 'cancelled'

export type ModifierOption = { name: string; price_paise: number }
export type ModifierGroup = { name: string; min: number; max: number; options: ModifierOption[] }

export type Property = {
  id: string
  slug: string
  name: string
  address: string | null
  phone: string | null
  brand_color: string
}

export type Room = {
  id: string
  property_id: string
  number: string
  floor: string | null
  room_type: string | null
  token: string
  occupied: boolean
  guest_name: string | null
  checked_in_at: string | null
}

export type Item = {
  id: string
  category_id: string
  name: string
  description: string | null
  price_paise: number
  unit: string | null
  department: string
  sla_minutes: number
  veg: boolean | null
  needs_time: boolean
  modifier_groups: ModifierGroup[]
  available: boolean
}

export type Category = {
  id: string
  kind: CategoryKind
  name: string
  icon: string | null
  items: Item[]
}

export type InfoPage = {
  id: string
  slug: string
  title: string
  body: string
  icon: string | null
}

export type RequestItem = {
  id: string
  name: string
  qty: number
  unit_price_paise: number
  modifiers: { group: string; name: string; price_paise: number }[]
  note: string | null
}

export type GuestRequest = {
  id: string
  ref: string
  kind: RequestKind
  department: string
  status: RequestStatus
  note: string | null
  scheduled_for: string | null
  total_paise: number
  sla_minutes: number
  created_at: string
  updated_at: string
  acknowledged_at: string | null
  completed_at: string | null
  escalated_at: string | null
  cancel_reason: string | null
  items: RequestItem[]
}

export type ChatMessage = {
  id: string
  sender: 'guest' | 'staff'
  staff_name: string | null
  body: string
  created_at: string
}

/** Everything the guest screen polls for. */
export type GuestState = {
  requests: GuestRequest[]
  messages: ChatMessage[]
  folio_total_paise: number
}

export type BoardRequest = GuestRequest & {
  room_id: string
  room_number: string
  room_floor: string | null
  guest_name: string | null
  assigned_to: string | null
  assigned_name: string | null
  property_name: string
  property_id: string
  unread_messages: number
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  new: 'New',
  ack: 'Accepted',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

/** What the guest is told, which is not always what staff see. */
export const GUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  new: 'Sent to the team',
  ack: 'Someone has picked this up',
  in_progress: 'On the way',
  done: 'Completed',
  cancelled: 'Cancelled',
}
