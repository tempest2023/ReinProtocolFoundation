import type { Metadata } from 'next'
import Link from 'next/link'
import { CommunityPageHero, CommunitySection } from '@/components/community-shell'
import { ContributionPaths, getContributionIssueLinks } from '@/components/contribution-paths'

export const metadata: Metadata = { title: 'Contribute', description: 'Help organize events, share presentations and learning materials, or offer peer guidance in the Rein AI agent community.' }

export default async function ContributePage() {
  const issueLinks = await getContributionIssueLinks()
  return <main id="main-content" className="community-shell"><CommunityPageHero eyebrow="Community / Contribute" title="Share what you know. Help someone move forward." lead="Host a local event, present online, share learning materials, or guide a member exploring a career working with AI agents." /><CommunitySection eyebrow="Choose a path" title="Contribute in the way that fits."><ContributionPaths issueLinks={issueLinks} /><p className="legal-note">Contributing does not create legal membership or employment. Publishing a resource does not automatically grant Contributor status. See the <Link href="/community/code-of-conduct">Code of Conduct</Link>.</p></CommunitySection></main>
}
