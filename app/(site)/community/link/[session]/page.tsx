import type { Metadata } from 'next'
import { LinkAccountView } from '../link-account-view'

export const metadata: Metadata = { title: 'Link Your Account', robots: { index: false, follow: false } }

export default async function LinkAccountSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ session: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const [{ session }, { status }] = await Promise.all([params, searchParams])
  return <LinkAccountView session={session} status={status} />
}
