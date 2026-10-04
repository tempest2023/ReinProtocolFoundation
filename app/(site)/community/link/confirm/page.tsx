import type { Metadata } from 'next'
import Link from 'next/link'
import { LinkConfirmForm } from '../link-forms'

export const metadata: Metadata = { title: 'Confirm Your Account Link', robots: { index: false, follow: false } }

export default async function LinkConfirmPage({ searchParams }: { searchParams: Promise<{ receipt?: string; session?: string }> }) {
  const { receipt, session } = await searchParams

  if (!receipt || !session) {
    return <main id="main-content" className="community-shell"><div className="page-shell form-page"><section className="empty-state"><p className="eyebrow">Community / Link account</p><h1>This link is not valid.</h1><div className="empty-state__copy"><p>The link may be incomplete, expired, or already used. Ask the Rein Agent in your chat platform for a new one.</p></div><div className="empty-state__actions"><Link href="/community" className="primary-action">Return to Community</Link></div></section></div></main>
  }

  return <main id="main-content" className="community-shell"><div className="page-shell form-page"><div className="form-layout"><aside className="form-intro"><p className="eyebrow">Community / Link account</p><h1>Confirm your email address.</h1><p className="form-intro__lead">Confirm this link to show that you can receive mail at the address it was sent to.</p></aside><LinkConfirmForm session={session} receipt={receipt} /></div></div></main>
}
