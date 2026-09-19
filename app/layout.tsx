import type { Metadata, Viewport } from 'next'
import { EB_Garamond, Instrument_Sans } from 'next/font/google'
import './globals.css'

const sans = Instrument_Sans({
  variable: '--font-sans-stack',
  subsets: ['latin'],
  display: 'swap',
})

/**
 * The display face carries everything from a 17px label in the staff panel to
 * an 84px headline on the marketing page, so it has to be a text face that
 * scales up rather than a display face that collapses down. A high-contrast
 * Didone looks right at 84px and turns to wire at 17.
 *
 * Variable, so weight is a knob rather than another file to download, and the
 * italic is a real drawn italic rather than a slant - the homepage leans on
 * one italic word and a faked oblique shows immediately at that size.
 */
const display = EB_Garamond({
  variable: '--font-display-stack',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
