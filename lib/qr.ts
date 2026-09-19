import QRCode from 'qrcode'
import { headers } from 'next/headers'

/**
 * QR codes are rendered as inline SVG on the server rather than fetched one by
 * one from an endpoint - a print sheet of 34 rooms would otherwise be 34
 * round-trips, and this way the sheet prints correctly from a cold page.
 */
export function qrSvg(text: string, size = 220): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 0,
    width: size,
    // 'M' still scans reliably after a card gets a coffee ring on it.
    errorCorrectionLevel: 'M',
    color: { dark: '#1c1917', light: '#ffffff' },
  })
}

/**
 * The origin to print into room QR codes. Taken from the live request so the
 * codes are right on localhost, on a preview deployment and in production
 * without anyone remembering to set an env var - NEXT_PUBLIC_BASE_URL only
 * overrides it when a hotel is on a custom domain behind something odd.
 */
export async function baseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_BASE_URL
  if (configured) return configured.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export const roomUrl = (base: string, token: string) => `${base}/r/${token}`
