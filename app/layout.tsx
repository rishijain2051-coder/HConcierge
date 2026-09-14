import type { Metadata, Viewport } from 'next'
import { Instrument_Sans } from 'next/font/google'
import './globals.css'

const sans = Instrument_Sans({
  variable: '--font-sans-stack',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'HConcierge',
  description: 'Everything your room needs, without picking up the phone.',
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
    <html lang="en" className={`${sans.variable} h-full antialiased`}>
      <body className="bg-paper text-ink min-h-full">{children}</body>
    </html>
  )
}
