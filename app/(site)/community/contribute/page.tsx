import type { Metadata } from 'next'
import Link from 'next/link'
import { CommunityPageHero, CommunitySection } from '@/components/community-shell'
import { ContributionPaths, getContributionIssueLinks } from '@/components/contribution-paths'

export const metadata: Metadata = { title: 'Contribute', description: 'Three ways to contribute to Rein: a private application, public GitHub work, or a public learning resource.' }

export default async function ContributePage() {
  const issueLinks = await getContributionIssueLinks()
  return <main id="main-content" className="community-shell"><CommunityPageHero eyebrow="Community / Contribute" title="Ways to contribute." lead="Take part in ongoing work, propose a public project, or share a free learning resource." /><CommunitySection eyebrow="Choose a path" title="Contribute in the way that fits."><ContributionPaths issueLinks={issueLinks} /><p className="legal-note">Contributing does not create legal membership or employment. Publishing a resource does not automatically grant Contributor status. See the <Link href="/community/code-of-conduct">Code of Conduct</Link>.</p></CommunitySection></main>
}
