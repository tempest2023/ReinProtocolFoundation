import type { Metadata } from 'next'
import '../src/index.css'
import '../src/App.css'
import './community.css'
import './admin.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Rein Protocol Foundation', template: '%s — Rein Protocol Foundation' },
  description: 'Making AI agents safe for people and society through community, open-source projects, and research into transparency, observability, and policy controls.',
  openGraph: { type: 'website', siteName: 'Rein Protocol Foundation' },
  manifest: '/site.webmanifest',
  appleWebApp: { title: 'Rein Protocol' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
