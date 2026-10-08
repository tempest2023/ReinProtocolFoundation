import { redirect } from 'next/navigation'

export default function LegacyContactsPage() {
  redirect('/admin/identities')
}
