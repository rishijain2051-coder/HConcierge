// Seeds RN Hospitality demo data: two properties, staff, rooms, the full
// in-room directory and info pages.
//
//   npm run db:seed              re-seed, refusing if live requests exist
//   npm run db:seed -- --force   wipe and re-seed anyway
//
// Re-running deletes each property by slug and rebuilds it, so the catalog is
// always exactly what this file says.
import { randomBytes, scryptSync } from 'node:crypto'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const force = process.argv.includes('--force')
const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 20 })

// Same format as hashPassword() in lib/auth.ts. Duplicated rather than imported
// because that module pulls in next/headers, which cannot load in a bare script.
const hash = (pw) => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`
}
const token = () => randomBytes(8).toString('base64url')
const R = (rupees) => rupees * 100 // paise

const SEED_PASSWORD = process.env.SEED_PASSWORD || 'RNhospitality@2026'

// ---------------------------------------------------------------- directory
// One catalog definition, applied to every property.
const SPICE = {
  name: 'Spice level',
  min: 1,
  max: 1,
  options: [
    { name: 'Mild', price_paise: 0 },
    { name: 'Medium', price_paise: 0 },
    { name: 'Spicy', price_paise: 0 },
  ],
}
const ADDONS = {
  name: 'Add-ons',
  min: 0,
  max: 3,
  options: [
    { name: 'Extra butter', price_paise: R(30) },
    { name: 'Extra cheese', price_paise: R(60) },
    { name: 'Extra gravy', price_paise: R(50) },
  ],
}
const EGG = {
  name: 'How would you like the eggs?',
  min: 1,
  max: 1,
  options: [
    { name: 'Sunny side up', price_paise: 0 },
    { name: 'Scrambled', price_paise: 0 },
    { name: 'Omelette', price_paise: 0 },
    { name: 'Boiled', price_paise: 0 },
  ],
}

const CATALOG = [
  // ---------------------------------------------------------- housekeeping
  {
    kind: 'amenity',
    name: 'Towels & linen',
    icon: '🛏️',
    items: [
      { name: 'Bath towels', sla: 10, unit: 'per set' },
      { name: 'Hand towels', sla: 10 },
      { name: 'Fresh bedsheets', sla: 20 },
      { name: 'Extra pillow', sla: 15 },
      { name: 'Extra blanket', sla: 15 },
      { name: 'Bathrobe', sla: 15 },
    ],
  },
  {
    kind: 'amenity',
    name: 'Bathroom & toiletries',
    icon: '🧴',
    items: [
      { name: 'Toiletries kit', desc: 'Soap, shampoo, conditioner, body wash', sla: 10 },
      { name: 'Toothbrush & toothpaste', sla: 10 },
      { name: 'Shaving kit', sla: 10 },
      { name: 'Toilet paper', sla: 10 },
      { name: 'Slippers', sla: 10 },
      { name: 'Sanitary kit', sla: 10 },
    ],
  },
  {
    kind: 'amenity',
    name: 'Room cleaning',
    icon: '🧹',
    items: [
      { name: 'Clean my room now', desc: 'Full housekeeping service', sla: 30 },
      { name: 'Turndown service', desc: 'Evening bed preparation', sla: 30 },
      { name: 'Empty the bin', sla: 15 },
      { name: 'Do not disturb', desc: 'We will skip your room today', sla: 5 },
      { name: 'Collect laundry bag', sla: 20 },
    ],
  },
  {
    kind: 'amenity',
    name: 'In-room equipment',
    icon: '🔌',
    items: [
      { name: 'Iron & ironing board', sla: 15 },
      { name: 'Extra hangers', sla: 15 },
      { name: 'Phone charger', desc: 'USB-C, Lightning or micro-USB', sla: 15 },
      { name: 'Universal adapter', sla: 15 },
      { name: 'Hair dryer', sla: 15 },
      { name: 'Extra drinking water', desc: '2 bottles, complimentary', sla: 10 },
    ],
  },
  {
    kind: 'amenity',
    name: 'Something is not working',
    icon: '🔧',
    department: 'maintenance',
    items: [
      { name: 'Air conditioning', sla: 20 },
      { name: 'Hot water / geyser', sla: 20 },
      { name: 'Television or remote', sla: 25 },
      { name: 'Wi-Fi not connecting', sla: 20 },
      { name: 'Lights or power socket', sla: 20 },
      { name: 'Door lock or key card', sla: 10 },
      { name: 'Leaking tap or drainage', sla: 25 },
      { name: 'Something else', desc: 'Tell us what is wrong', sla: 25 },
    ],
  },

  // -------------------------------------------------------- food & beverage
  {
    kind: 'fnb',
    name: 'Breakfast',
    icon: '🍳',
    note: 'Served 7:00-10:30 am',
    items: [
      { name: 'Masala Dosa', price: R(260), veg: true, sla: 30, mods: [SPICE] },
      { name: 'Idli Sambar', desc: 'Three pieces, coconut chutney', price: R(220), veg: true, sla: 25 },
      { name: 'Poha', desc: 'Flattened rice, peanuts, lemon', price: R(190), veg: true, sla: 20 },
      { name: 'Aloo Paratha', desc: 'Two pieces, curd and pickle', price: R(240), veg: true, sla: 30, mods: [ADDONS] },
      { name: 'English Breakfast', desc: 'Eggs, sausage, grilled tomato, toast', price: R(480), veg: false, sla: 30, mods: [EGG] },
      { name: 'Eggs to Order', desc: 'Two eggs with toast', price: R(280), veg: false, sla: 20, mods: [EGG] },
      { name: 'Fruit Platter', price: R(260), veg: true, sla: 15 },
      { name: 'Curd & Granola Bowl', price: R(290), veg: true, sla: 15 },
    ],
  },
  {
    kind: 'fnb',
    name: 'Starters',
    icon: '🥘',
    items: [
      { name: 'Paneer Tikka', price: R(420), veg: true, sla: 30, mods: [SPICE] },
      { name: 'Hara Bhara Kebab', price: R(380), veg: true, sla: 30 },
      { name: 'Chilli Paneer', price: R(400), veg: true, sla: 30, mods: [SPICE] },
      { name: 'Murgh Malai Tikka', price: R(520), veg: false, sla: 35, mods: [SPICE] },
      { name: 'Chicken 65', price: R(480), veg: false, sla: 30, mods: [SPICE] },
      { name: 'Tandoori Prawns', price: R(720), veg: false, sla: 35, mods: [SPICE] },
    ],
  },
  {
    kind: 'fnb',
    name: 'Main course',
    icon: '🍛',
    items: [
      { name: 'Dal Makhani', price: R(360), veg: true, sla: 30, mods: [SPICE, ADDONS] },
      { name: 'Paneer Butter Masala', price: R(420), veg: true, sla: 30, mods: [SPICE, ADDONS] },
      { name: 'Kadai Vegetable', price: R(380), veg: true, sla: 30, mods: [SPICE] },
      { name: 'Butter Chicken', price: R(540), veg: false, sla: 35, mods: [SPICE, ADDONS] },
      { name: 'Rogan Josh', price: R(620), veg: false, sla: 40, mods: [SPICE] },
      { name: 'Goan Fish Curry', price: R(640), veg: false, sla: 35, mods: [SPICE] },
    ],
  },
  {
    kind: 'fnb',
    name: 'Breads, rice & biryani',
    icon: '🍚',
    items: [
      { name: 'Tandoori Roti', price: R(70), veg: true, sla: 20 },
      { name: 'Butter Naan', price: R(90), veg: true, sla: 20 },
      { name: 'Laccha Paratha', price: R(110), veg: true, sla: 20 },
      { name: 'Jeera Rice', price: R(240), veg: true, sla: 25 },
      { name: 'Veg Biryani', price: R(420), veg: true, sla: 35, mods: [SPICE] },
      { name: 'Hyderabadi Chicken Biryani', price: R(560), veg: false, sla: 40, mods: [SPICE] },
    ],
  },
  {
    kind: 'fnb',
    name: 'Continental & light bites',
    icon: '🍕',
    items: [
      { name: 'Club Sandwich', price: R(380), veg: false, sla: 25 },
      { name: 'Grilled Veg Sandwich', price: R(320), veg: true, sla: 20 },
      { name: 'Margherita Pizza', price: R(460), veg: true, sla: 35, mods: [ADDONS] },
      { name: 'Penne Alfredo', price: R(440), veg: true, sla: 30, mods: [ADDONS] },
      { name: 'French Fries', price: R(220), veg: true, sla: 20 },
      { name: 'Chicken Burger', price: R(420), veg: false, sla: 30 },
    ],
  },
  {
    kind: 'fnb',
    name: 'Desserts',
    icon: '🍮',
    items: [
      { name: 'Gulab Jamun', desc: 'Two pieces', price: R(200), veg: true, sla: 15 },
      { name: 'Gajar Halwa', price: R(240), veg: true, sla: 15 },
      { name: 'Chocolate Brownie', desc: 'With vanilla ice cream', price: R(280), veg: true, sla: 15 },
      { name: 'Ice Cream', desc: 'Vanilla, chocolate or mango', price: R(180), veg: true, sla: 15 },
    ],
  },
  {
    kind: 'fnb',
    name: 'Beverages',
    icon: '☕',
    items: [
      { name: 'Masala Chai', price: R(140), veg: true, sla: 15 },
      { name: 'Filter Coffee', price: R(160), veg: true, sla: 15 },
      { name: 'Cappuccino', price: R(220), veg: true, sla: 15 },
      { name: 'Fresh Lime Soda', price: R(180), veg: true, sla: 15 },
      { name: 'Mango Lassi', price: R(220), veg: true, sla: 15 },
      { name: 'Cold Coffee', price: R(240), veg: true, sla: 15 },
      { name: 'Bottled Water 1L', price: R(80), veg: true, sla: 10 },
      { name: 'Soft Drink', price: R(120), veg: true, sla: 10 },
    ],
  },
  {
    kind: 'fnb',
    name: 'Bar',
    icon: '🍷',
    note: 'Served 12:00 pm-11:00 pm. Guests must be 21 or older.',
    items: [
      { name: 'Kingfisher Premium', desc: '650 ml', price: R(380), veg: false, sla: 20 },
      { name: 'Bira White', desc: '330 ml', price: R(320), veg: false, sla: 20 },
      { name: 'House Red Wine', desc: 'Glass', price: R(520), veg: false, sla: 20 },
      { name: 'House White Wine', desc: 'Glass', price: R(520), veg: false, sla: 20 },
      { name: 'Old Monk & Coke', price: R(420), veg: false, sla: 20 },
      { name: 'Single Malt', desc: '30 ml', price: R(890), veg: false, sla: 20 },
    ],
  },

  // --------------------------------------------------------- paid services
  {
    kind: 'service',
    name: 'Laundry & dry cleaning',
    icon: '👔',
    department: 'housekeeping',
    note: 'Given before 9 am, returned same day by 7 pm.',
    items: [
      { name: 'Shirt - wash & press', price: R(120), unit: 'per piece', sla: 30 },
      { name: 'Trousers - wash & press', price: R(140), unit: 'per piece', sla: 30 },
      { name: 'Suit - dry clean', price: R(450), unit: 'per piece', sla: 30 },
      { name: 'Saree - dry clean', price: R(400), unit: 'per piece', sla: 30 },
      { name: 'Kurta - wash & press', price: R(150), unit: 'per piece', sla: 30 },
      { name: 'Express service surcharge', desc: 'Returned within 4 hours', price: R(250), sla: 30 },
    ],
  },
  {
    kind: 'service',
    name: 'Spa & wellness',
    icon: '💆',
    department: 'front_desk',
    note: 'Open 9 am-9 pm. Booking confirmed by the spa desk.',
    items: [
      { name: 'Swedish Massage', desc: '60 minutes', price: R(3200), sla: 20, needs_time: true },
      { name: 'Deep Tissue Massage', desc: '60 minutes', price: R(3800), sla: 20, needs_time: true },
      { name: 'Ayurvedic Abhyanga', desc: '75 minutes', price: R(4200), sla: 20, needs_time: true },
      { name: 'Head & Shoulder Massage', desc: '30 minutes', price: R(1800), sla: 20, needs_time: true },
      { name: 'Salon appointment', desc: 'Haircut, styling or grooming', price: 0, sla: 20, needs_time: true },
    ],
  },
  {
    kind: 'service',
    name: 'Travel & transport',
    icon: '🚗',
    department: 'front_desk',
    items: [
      { name: 'Airport drop - sedan', price: R(1400), sla: 20, needs_time: true },
      { name: 'Airport drop - SUV', price: R(2100), sla: 20, needs_time: true },
      { name: 'Airport pickup', price: R(1500), sla: 20, needs_time: true },
      { name: 'Taxi to city', desc: 'Metered, billed on return', price: 0, sla: 15, needs_time: true },
      { name: 'Car with driver - 8 hours', price: R(3500), sla: 30, needs_time: true },
      { name: 'City tour booking', price: 0, sla: 30, needs_time: true },
    ],
  },
  {
    kind: 'service',
    name: 'Guest assistance',
    icon: '🩺',
    department: 'front_desk',
    items: [
      { name: 'Doctor on call', desc: 'Available 24 hours', price: R(1200), sla: 10 },
      { name: 'Pharmacy run', desc: 'Share your prescription with the front desk', price: 0, sla: 30 },
      { name: 'Baby cot', price: 0, sla: 25 },
      { name: 'Babysitting', desc: 'Minimum 3 hours, 12 hours notice', price: R(600), unit: 'per hour', sla: 30, needs_time: true },
      { name: 'Florist / cake for an occasion', price: 0, sla: 30, needs_time: true },
    ],
  },

  // ------------------------------------------------------------ front desk
  {
    kind: 'front_desk',
    name: 'Front desk',
    icon: '🛎️',
    department: 'front_desk',
    items: [
      { name: 'Wake-up call', sla: 10, needs_time: true },
      { name: 'Late checkout request', desc: 'Subject to availability', sla: 20 },
      { name: 'Extend my stay', sla: 20 },
      { name: 'Show me my bill so far', sla: 15 },
      { name: 'I would like to check out', desc: 'We will have your bill ready', sla: 15 },
      { name: 'Luggage pickup', sla: 15 },
      { name: 'Luggage storage after checkout', sla: 15 },
      { name: 'Printing or photocopy', sla: 20 },
      { name: 'Currency exchange', sla: 25 },
      { name: 'Book the conference room', sla: 30, needs_time: true },
    ],
  },
]

const INFO_PAGES = [
  {
    slug: 'wifi',
    title: 'Wi-Fi',
    icon: '📶',
    body: 'Network: RN-Guest\nPassword: rnstay2026\n\nConnect, open any page and accept the terms. If it does not connect, send us a message and maintenance will come up.\n\nA faster network (RN-Guest-5G, same password) is available on floors 1 to 4.',
  },
  {
    slug: 'timings',
    title: 'Check-in & checkout',
    icon: '🕐',
    body: 'Check-in: 2:00 pm\nCheckout: 11:00 am\n\nLate checkout until 2:00 pm is complimentary when the hotel has space. Just ask from the Front desk menu. After 2:00 pm, half a day is charged.\n\nEarly check-in depends on the previous night. We will always try.',
  },
  {
    slug: 'dining',
    title: 'Dining hours',
    icon: '🍽️',
    body: 'Breakfast buffet: 7:00 to 10:30 am, ground floor\nLunch: 12:30 to 3:00 pm\nDinner: 7:00 to 11:00 pm\nBar: 12:00 noon to 11:00 pm\n\nRoom service runs 24 hours. Between 11:00 pm and 7:00 am, a limited night menu applies and a ₹150 tray charge is added.',
  },
  {
    slug: 'facilities',
    title: 'Pool, gym & spa',
    icon: '🏊',
    body: 'Swimming pool: 6:00 am to 8:00 pm, terrace level. Towels are at the pool desk.\nGym: open 24 hours, key card access, second floor.\nSpa: 9:00 am to 9:00 pm, book from the Services menu.\n\nChildren under 12 must be accompanied at the pool.',
  },
  {
    slug: 'emergency',
    title: 'Emergency & safety',
    icon: '🚨',
    body: 'Front desk: dial 9 from the room phone, or message us here.\nMedical emergency: dial 9, or 108 for an ambulance.\nFire: break glass alarms are at both ends of every corridor.\n\nYour nearest fire exit is marked on the back of your room door. Lifts are not to be used during an alarm.\n\nA doctor can be called to your room 24 hours a day from the Services menu.',
  },
  {
    slug: 'house-rules',
    title: 'House rules',
    icon: '📋',
    body: 'Smoking is not permitted in rooms. Designated smoking areas are on the terrace and near the lobby entrance. A ₹5,000 cleaning charge applies to smoking in a room.\n\nVisitors may be received in the lobby. Visitors are not permitted in rooms after 10:00 pm.\n\nPlease keep noise down between 10:00 pm and 7:00 am.\n\nPets are not permitted.',
  },
  {
    slug: 'nearby',
    title: 'Around the hotel',
    icon: '📍',
    body: 'The front desk can arrange a car for any of these.\n\nWalking distance: the main market (8 min), a pharmacy (5 min), an ATM in the lobby.\n\nWorth a trip: the old fort (20 min by car), the riverside promenade (15 min), the craft bazaar, open Saturdays.\n\nAsk us for recommendations. We live here.',
  },
]

const QUICK_REPLIES = [
  { label: 'On the way', body: 'Someone is on the way to your room now.' },
  { label: 'Pool hours', body: 'The pool is open 6:00 am to 8:00 pm on the terrace level. Towels are at the pool desk.' },
  { label: 'Breakfast', body: 'Breakfast is served 7:00 to 10:30 am on the ground floor, and is included with your stay.' },
  { label: 'Late checkout ok', body: 'Late checkout until 2:00 pm is confirmed for you, with our compliments.' },
  { label: 'Checkout time', body: 'Checkout is at 11:00 am. Let us know if you would like us to request a later time.' },
  { label: 'Wi-Fi', body: 'Connect to RN-Guest and use the password rnstay2026. Tell us if it still will not connect.' },
  { label: 'Kitchen delay', body: 'Apologies, the kitchen is running about 15 minutes behind. Your order is being prepared.' },
  { label: 'Anything else', body: 'Happy to help. Anything else you need, just message here.' },
]

/**
 * What the hotel is running this season. The desk honours these at checkout -
 * nothing here discounts a folio by itself, see lib/promotions.ts.
 */
const PROMOTIONS = [
  {
    title: 'Welcome drink, on us',
    description:
      'A complimentary drink at the lobby bar: a cocktail, a mocktail or a filter coffee, whichever suits the hour.',
    kind: 'coupon',
    minSpend: 0,
    percentOff: null,
    department: 'fnb',
    finePrint: 'One per stay, served at the bar.',
  },
  {
    title: 'Pool & gym day passes',
    description:
      'Two day passes for the rooftop pool and the gym, yours once the room bill passes two thousand rupees.',
    kind: 'pass',
    minSpend: R(2000),
    percentOff: null,
    department: 'front_desk',
    finePrint: 'Collect the wristbands at the front desk.',
  },
  {
    title: '15% off every spa treatment',
    description:
      'Fifteen per cent off the whole spa menu for the length of your stay: massages, facials, the lot.',
    kind: 'discount',
    minSpend: 0,
    percentOff: 15,
    department: 'spa_wellness',
    finePrint: 'Applied when you settle. Not with other offers.',
  },
]

const PROPERTIES = [
  {
    slug: 'rn-grand-pune',
    name: 'RN Grand, Pune',
    address: 'Koregaon Park, Pune 411001',
    phone: '+91 20 4000 1000',
    brand_color: '#0F766E',
    floors: [
      ['1', ['101', '102', '103', '104', '105', '106']],
      ['2', ['201', '202', '203', '204', '205', '206']],
      ['3', ['301', '302', '303', '304', '305', '306']],
      ['4', ['401', '402', '403', '404']],
    ],
  },
  {
    slug: 'rn-suites-mumbai',
    name: 'RN Suites, Mumbai',
    address: 'Andheri East, Mumbai 400059',
    phone: '+91 22 4000 2000',
    brand_color: '#7C3AED',
    floors: [
      ['1', ['101', '102', '103', '104']],
      ['2', ['201', '202', '203', '204']],
      ['3', ['301', '302', '303', '304']],
    ],
  },
]

const STAFF = [
  { username: 'rn.admin', name: 'RN Group Admin', role: 'admin', department: 'all', property: null },
  { username: 'pune.manager', name: 'Priya Deshmukh', role: 'manager', department: 'all', property: 'rn-grand-pune' },
  { username: 'pune.reception', name: 'Arjun Kale', role: 'staff', department: 'front_desk', property: 'rn-grand-pune' },
  { username: 'pune.housekeeping', name: 'Sunita Rao', role: 'staff', department: 'housekeeping', property: 'rn-grand-pune' },
  { username: 'pune.kitchen', name: 'Chef Imran Sheikh', role: 'staff', department: 'fnb', property: 'rn-grand-pune' },
  { username: 'pune.maintenance', name: 'Ramesh Patil', role: 'staff', department: 'maintenance', property: 'rn-grand-pune' },
  { username: 'mumbai.manager', name: 'Farah Qureshi', role: 'manager', department: 'all', property: 'rn-suites-mumbai' },
  { username: 'mumbai.reception', name: 'Nikhil Menon', role: 'staff', department: 'front_desk', property: 'rn-suites-mumbai' },
]

const DEPT_FOR_KIND = { amenity: 'housekeeping', fnb: 'fnb', service: 'front_desk', front_desk: 'front_desk' }

async function main() {
  const [{ count: liveRequests }] = await sql`select count(*)::int as count from requests`
  if (liveRequests > 0 && !force) {
    console.error(
      `✗ ${liveRequests} request(s) already exist. Seeding wipes the demo properties.\n` +
        '  Re-run with:  npm run db:seed -- --force',
    )
    process.exitCode = 1
    return
  }

  const passwordHash = hash(SEED_PASSWORD)
  const roomLinks = []

  for (const p of PROPERTIES) {
    // Cascades clear this property's rooms, catalog, requests and messages.
    await sql`delete from properties where slug = ${p.slug}`
    const [prop] = await sql`
      insert into properties (slug, name, address, phone, brand_color)
      values (${p.slug}, ${p.name}, ${p.address}, ${p.phone}, ${p.brand_color})
      returning id`

    for (const [floor, numbers] of p.floors) {
      for (const number of numbers) {
        const [room] = await sql`
          insert into rooms (property_id, number, floor, room_type, token)
          values (${prop.id}, ${number}, ${floor},
                  ${floor === '4' ? 'Suite' : 'Deluxe'}, ${token()})
          returning number, token`
        roomLinks.push({ property: p.name, ...room })
      }
    }

    for (const [ci, cat] of CATALOG.entries()) {
      const [category] = await sql`
        insert into categories (property_id, kind, name, icon, sort)
        values (${prop.id}, ${cat.kind}, ${cat.name}, ${cat.icon ?? null}, ${ci})
        returning id`

      for (const [ii, item] of cat.items.entries()) {
        await sql`
          insert into items (property_id, category_id, name, description, price_paise, unit,
                             department, sla_minutes, veg, needs_time, modifier_groups, sort)
          values (${prop.id}, ${category.id}, ${item.name}, ${item.desc ?? cat.note ?? null},
                  ${item.price ?? 0}, ${item.unit ?? null},
                  ${item.department ?? cat.department ?? DEPT_FOR_KIND[cat.kind]},
                  ${item.sla ?? 20}, ${item.veg ?? null}, ${item.needs_time ?? false},
                  ${sql.json(item.mods ?? [])}, ${ii})`
      }
    }

    for (const [i, page] of INFO_PAGES.entries()) {
      await sql`
        insert into info_pages (property_id, slug, title, body, icon, sort)
        values (${prop.id}, ${page.slug}, ${page.title}, ${page.body}, ${page.icon}, ${i})`
    }

    for (const [i, q] of QUICK_REPLIES.entries()) {
      await sql`insert into quick_replies (property_id, label, body, sort)
                values (${prop.id}, ${q.label}, ${q.body}, ${i})`
    }

    for (const [i, promo] of PROMOTIONS.entries()) {
      await sql`
        insert into promotions (property_id, title, description, kind, min_spend_paise,
                                percent_off, department, fine_print, sort)
        values (${prop.id}, ${promo.title}, ${promo.description}, ${promo.kind}, ${promo.minSpend},
                ${promo.percentOff}, ${promo.department}, ${promo.finePrint}, ${i})`
    }

    console.log(`✓ ${p.name}`)
  }

  const props = await sql`select id, slug from properties`
  const bySlug = Object.fromEntries(props.map((r) => [r.slug, r.id]))

  for (const s of STAFF) {
    await sql`
      insert into staff (property_id, username, name, password_hash, department, role)
      values (${s.property ? bySlug[s.property] : null}, ${s.username}, ${s.name},
              ${passwordHash}, ${s.department}, ${s.role})
      on conflict (lower(username)) do update
        set password_hash = excluded.password_hash,
            property_id = excluded.property_id,
            department = excluded.department,
            role = excluded.role,
            active = true,
            failed_logins = 0,
            locked_until = null`
  }

  // Two rooms start occupied so the demo has somewhere to order from.
  await sql`
    update rooms set occupied = true, guest_name = 'Mr. Kabir Anand', checked_in_at = now()
     where number = '204' and property_id = ${bySlug['rn-grand-pune']}`
  await sql`
    update rooms set occupied = true, guest_name = 'Ms. Leela Iyer', checked_in_at = now()
     where number = '301' and property_id = ${bySlug['rn-grand-pune']}`

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const demo = roomLinks.filter((r) => ['204', '301'].includes(r.number) && r.property === 'RN Grand, Pune')

  console.log(`\n✓ ${STAFF.length} staff · ${roomLinks.length} rooms · ${CATALOG.length} directory sections`)
  console.log(`\n  Staff login - ${base}/staff/login`)
  for (const s of STAFF) console.log(`    ${s.username.padEnd(20)} ${s.name}`)
  console.log(`\n  Password for all of them: ${SEED_PASSWORD}`)
  console.log('  (every account is flagged to change it at first login)')
  console.log('\n  Occupied demo rooms - open these on a phone:')
  for (const r of demo) console.log(`    Room ${r.number}  ${base}/r/${r.token}`)
  console.log('')
}

try {
  await main()
} catch (err) {
  console.error('✗ seed failed:', err.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
