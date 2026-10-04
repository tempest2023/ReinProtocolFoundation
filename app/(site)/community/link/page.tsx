import type { Metadata } from 'next'
import { LinkAccountView } from './link-account-view'

export const metadata: Metadata = { title: 'Link Your Account', robots: { index: false, follow: false } }

export default async function LinkAccountPage({ searchParams }: { searchParams: Promise<{ session?: string; status?: string }> }) {
  const { session, status } = await searchParams
  return <LinkAccountView session={session} status={status} />
}
