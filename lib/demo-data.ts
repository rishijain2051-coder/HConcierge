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

/**
 * Everything a guest can ask for, grouped by the team that owns it.
 *
 * Flat, this was 118 names in one paragraph - a wall on a phone that argued
 * only "there are a lot". Grouped it makes the better argument: each line is
 * routed, and the routing is the product. Straight from the seed either way.
 */
export const DIRECTORY_BREADTH: { team: string; items: string[] }[] = [
  {
    team: 'Housekeeping',
    items: [
      'Bath towels', 'Hand towels', 'Fresh bedsheets', 'Extra pillow', 'Extra blanket', 'Bathrobe',
      'Toiletries kit', 'Toothbrush & toothpaste', 'Shaving kit', 'Toilet paper', 'Slippers',
      'Sanitary kit', 'Clean my room now', 'Turndown service', 'Empty the bin', 'Do not disturb',
      'Collect laundry bag', 'Iron & ironing board', 'Extra hangers', 'Phone charger',
      'Universal adapter', 'Hair dryer', 'Extra drinking water', 'Shirt - wash & press',
      'Trousers - wash & press', 'Suit - dry clean', 'Saree - dry clean', 'Kurta - wash & press',
      'Express laundry',
    ],
  },
  {
    team: 'Maintenance',
    items: [
      'Air conditioning', 'Hot water / geyser', 'Television or remote', 'Wi-Fi not connecting',
      'Lights or power socket', 'Door lock or key card', 'Leaking tap',
    ],
  },
  {
    team: 'Food & beverage',
    items: [
      'Masala Dosa', 'Idli Sambar', 'Poha', 'Aloo Paratha', 'English Breakfast', 'Eggs to Order',
      'Fruit Platter', 'Curd & Granola Bowl', 'Paneer Tikka', 'Hara Bhara Kebab', 'Chilli Paneer',
      'Murgh Malai Tikka', 'Chicken 65', 'Tandoori Prawns', 'Dal Makhani', 'Paneer Butter Masala',
      'Kadai Vegetable', 'Butter Chicken', 'Rogan Josh', 'Goan Fish Curry', 'Tandoori Roti',
      'Butter Naan', 'Laccha Paratha', 'Jeera Rice', 'Veg Biryani', 'Hyderabadi Chicken Biryani',
      'Club Sandwich', 'Grilled Veg Sandwich', 'Margherita Pizza', 'Penne Alfredo', 'French Fries',
      'Chicken Burger', 'Gulab Jamun', 'Gajar Halwa', 'Chocolate Brownie', 'Ice Cream', 'Masala Chai',
      'Filter Coffee', 'Cappuccino', 'Fresh Lime Soda', 'Mango Lassi', 'Cold Coffee', 'Bottled Water',
      'Soft Drink', 'Kingfisher Premium', 'Bira White', 'House Red Wine', 'Old Monk & Coke',
      'Single Malt',
    ],
  },
  {
    team: 'Spa & wellness',
    items: [
      'Swedish Massage', 'Deep Tissue Massage', 'Ayurvedic Abhyanga', 'Head & Shoulder Massage',
      'Salon appointment',
    ],
  },
  {
    team: 'Front desk',
    items: [
      'Airport drop - sedan', 'Airport drop - SUV', 'Airport pickup', 'Taxi to city',
      'Car with driver', 'City tour booking', 'Doctor on call', 'Pharmacy run', 'Baby cot',
      'Babysitting', 'Florist or cake', 'Wake-up call', 'Late checkout', 'Extend my stay',
      'Show me my bill', 'Check out', 'Luggage pickup', 'Luggage storage', 'Printing or photocopy',
      'Currency exchange', 'Book the conference room',
    ],
  },
]

/** Every routed line, counted once. */
export const DIRECTORY_COUNT = DIRECTORY_BREADTH.reduce((n, g) => n + g.items.length, 0)
