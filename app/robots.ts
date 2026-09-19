import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * What a crawler may read, which is the marketing site and nothing else.
 *
 * Every other route in this application is somebody's private surface: a room
 * link opens a guest's bill and their thread with the desk, a job link opens a
 * staff member's workload, and the staff app is behind a session. Those pages
 * already carry `robots: { index: false }` in their own metadata, which is the
 * real control - a crawler that ignores this file still reads the meta tag.
 * This exists so a well-behaved one never requests them at all, because a URL
 * in a crawl log is a URL in somebody's referrer header.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/staff/', '/r/', '/w/', '/c/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
