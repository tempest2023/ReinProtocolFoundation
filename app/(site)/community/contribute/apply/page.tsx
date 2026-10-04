import type { Metadata } from 'next'
import Link from 'next/link'
import { CommunityPageHero } from '@/components/community-shell'
import { ContributorForm } from '@/components/forms/contributor-form'

export const metadata: Metadata = { title: 'Contributor Application', description: 'Apply for deeper participation in Rein community work.' }
export const maxDuration = 60

export default function ContributorApplicationPage() {
  return <main id="main-content" className="community-shell">
    <CommunityPageHero
      eyebrow="Community / Apply"
      title="Apply as a Contributor."
      lead="Most public resources and events are open to everyone. Apply to help organize events, lead online presentations, develop shared learning materials, or offer mentoring and career guidance."
    />
    <section className="community-section">
      <div className="page-shell application-form">
        <div className="form-notice application-form__notice">
          <strong>A conversation, not an interview.</strong>
          If invited, we will schedule a friendly 1v1 of up to 30 minutes to introduce Rein, learn about your interests, and discuss possible next steps.
        </div>
        <p className="application-form__conduct">We welcome people from different backgrounds and fields. All participants must follow our <Link href="/community/code-of-conduct">Code of Conduct</Link>.</p>
        <ContributorForm />
      </div>
    </section>
  </main>
}
