import Link from 'next/link'
import { Arrow } from '@/components/icons'
import { getPublicSiteSettings } from '@/lib/community/data'

export async function getContributionIssueLinks() {
  const defaultRepository = 'https://github.com/tempest2023/ReinProtocolFoundation'
  const settings = await getPublicSiteSettings(['github_repository_url', 'github_event_url', 'github_campus_url', 'github_technical_url'])
  const repository = settings.github_repository_url ?? defaultRepository
  return [
    { label: 'Event proposal', href: settings.github_event_url ?? `${repository}/issues/new?template=event-proposal.yml` },
    { label: 'Campus volunteer', href: settings.github_campus_url ?? `${repository}/issues/new?template=campus-volunteer.yml` },
    { label: 'Technical contribution', href: settings.github_technical_url ?? `${repository}/issues/new?template=technical-contribution.yml` },
  ]
}

export function ContributionPaths({ issueLinks }: { issueLinks: Awaited<ReturnType<typeof getContributionIssueLinks>> }) {
  return <ol className="contribution-list">
    <li><span>01</span><div><p className="article-kicker">Contributor</p><h3>Join ongoing work.</h3><p>Organize activities or take responsibility for a project.</p><Link href="/community/contribute/apply" className="text-action">Apply privately <Arrow /></Link></div></li>
    <li><span>02</span><div><p className="article-kicker">GitHub</p><h3>Propose public work.</h3><p>Open an Issue Form for an event, campus activity, or technical contribution.</p><ul className="github-contribution-links">{issueLinks.map(({ label, href }) => <li key={label}><a href={href} target="_blank" rel="noreferrer">{label} <span aria-hidden="true">↗</span></a></li>)}</ul><p className="field-hint">GitHub submissions are public. Do not include private contact details, addresses, confidential material, or credentials.</p></div></li>
    <li><span>03</span><div><p className="article-kicker">Learn</p><h3>Share a learning resource.</h3><p>Submit a free public video, document, course, paper discussion, tool, or reference.</p><Link href="/community/contribute/resources/submit" className="text-action">Submit a resource <Arrow /></Link></div></li>
  </ol>
}
