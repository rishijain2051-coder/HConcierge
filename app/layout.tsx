import type { Metadata, Viewport } from 'next'
import { Instrument_Sans, Instrument_Serif } from 'next/font/google'
import './globals.css'

const sans = Instrument_Sans({
  variable: '--font-sans-stack',
  subsets: ['latin'],
  display: 'swap',
})

const display = Instrument_Serif({
  variable: '--font-display-stack',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'HConcierge',
  description: 'Guests ask from their own phone. Every request routes to the team that does it, carries its own target time, and escalates itself when that target is missed.',
}

export const viewport: Viewport = {
  themeColor: '#faf8f5',
  width: 'device-width',
  initialScale: 1,
  // Guests will pinch a menu. Let them.
  maximumScale: 5,
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full antialiased`}>
      <body className="bg-paper text-ink min-h-full">{children}</body>
    </html>
  )
}
