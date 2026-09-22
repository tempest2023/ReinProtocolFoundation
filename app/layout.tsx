import type { Metadata } from 'next'
import '../src/index.css'
import '../src/App.css'
import './community.css'
import './admin.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Rein Protocol Foundation', template: '%s — Rein Protocol Foundation' },
  description: 'Advancing beneficial AI Agents, public knowledge, and accountable infrastructure for the Agent age.',
  openGraph: { type: 'website', siteName: 'Rein Protocol Foundation' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
