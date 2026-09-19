/**
 * A slice of RN Grand, Pune's real seeded directory, frozen for the homepage
 * demo. It is a snapshot rather than a live query on purpose: a pitch page
 * should render instantly and must never 500 because a database is asleep.
 *
 * Keep these in step with db/seed.mjs - the point of the demo is that it shows
 * the product's actual catalogue, prices and target times, not a mock-up.
 */

export type DemoDept = 'housekeeping' | 'fnb' | 'front_desk' | 'maintenance'

export type DemoItem = {
  id: string
  name: string
  note?: string
  /** paise; 0 is complimentary */
  price: number
  dept: DemoDept
  /** target minutes, inherited by the request */
  sla: number
  veg?: boolean
}

export type DemoSection = {
  id: string
  label: string
  tab: 'ask' | 'dining' | 'services'
  items: DemoItem[]
}

export const DEPT_LABEL: Record<DemoDept, string> = {
  housekeeping: 'Housekeeping',
  fnb: 'Food & beverage',
  front_desk: 'Front desk',
  maintenance: 'Maintenance',
}

export const DEMO_SECTIONS: DemoSection[] = [
  {
    id: 'ask',
    label: 'Most asked for',
    tab: 'ask',
    items: [
      { id: 'towels', name: 'Bath towels', price: 0, dept: 'housekeeping', sla: 10 },
      { id: 'toiletries', name: 'Toiletries kit', note: 'Soap, shampoo, body wash', price: 0, dept: 'housekeeping', sla: 10 },
      { id: 'water', name: 'Extra drinking water', note: 'Two bottles, complimentary', price: 0, dept: 'housekeeping', sla: 10 },
      { id: 'clean', name: 'Clean my room now', price: 0, dept: 'housekeeping', sla: 30 },
      { id: 'wakeup', name: 'Wake-up call', price: 0, dept: 'front_desk', sla: 10 },
      { id: 'latecheckout', name: 'Late checkout', note: 'Subject to availability', price: 0, dept: 'front_desk', sla: 20 },
      { id: 'ac', name: 'Air conditioning not working', price: 0, dept: 'maintenance', sla: 20 },
      { id: 'wifi', name: 'Wi-Fi will not connect', price: 0, dept: 'maintenance', sla: 20 },
    ],
  },
  {
    id: 'dining',
    label: 'Room service',
    tab: 'dining',
    items: [
      { id: 'dosa', name: 'Masala Dosa', price: 26000, dept: 'fnb', sla: 30, veg: true },
      { id: 'butterchicken', name: 'Butter Chicken', price: 54000, dept: 'fnb', sla: 35, veg: false },
      { id: 'paneer', name: 'Paneer Butter Masala', price: 42000, dept: 'fnb', sla: 30, veg: true },
      { id: 'naan', name: 'Butter Naan', price: 9000, dept: 'fnb', sla: 20, veg: true },
      { id: 'biryani', name: 'Hyderabadi Chicken Biryani', price: 56000, dept: 'fnb', sla: 40, veg: false },
      { id: 'chai', name: 'Masala Chai', price: 14000, dept: 'fnb', sla: 15, veg: true },
      { id: 'coldcoffee', name: 'Cold Coffee', price: 24000, dept: 'fnb', sla: 15, veg: true },
      { id: 'gulabjamun', name: 'Gulab Jamun', note: 'Two pieces', price: 20000, dept: 'fnb', sla: 15, veg: true },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    tab: 'services',
    items: [
      { id: 'shirt', name: 'Shirt - wash & press', note: 'Back by 7 pm', price: 12000, dept: 'housekeeping', sla: 30 },
      { id: 'suit', name: 'Suit - dry clean', price: 45000, dept: 'housekeeping', sla: 30 },
      { id: 'massage', name: 'Swedish Massage', note: '60 minutes', price: 320000, dept: 'front_desk', sla: 20 },
      { id: 'airport', name: 'Airport drop - sedan', price: 140000, dept: 'front_desk', sla: 20 },
      { id: 'doctor', name: 'Doctor on call', note: 'Available 24 hours', price: 120000, dept: 'front_desk', sla: 10 },
      { id: 'luggage', name: 'Luggage pickup', price: 0, dept: 'front_desk', sla: 15 },
    ],
  },
]
