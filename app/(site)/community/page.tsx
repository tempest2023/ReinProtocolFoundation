import type { Metadata } from 'next'
import Link from 'next/link'
import communityConvergence from '@/src/assets/scenes/community-convergence.webp'
import { Arrow } from '@/components/icons'
import { CommunitySection } from '@/components/community-shell'
import { ContributionPaths, getContributionIssueLinks } from '@/components/contribution-paths'
import { ParticipantForm } from '@/components/forms/participant-form'
import { ProfileCard } from '@/components/profile-card'
import { getPublishedEvents, getPublishedResources, getPublicMemberMetrics, getPublicPeople } from '@/lib/community/data'
import { publicCommunityAudience } from '@/lib/community/presentation'

export const metadata: Metadata = { title: 'Community', description: 'Learn, gather, and contribute with the Rein community.' }
export const maxDuration = 60

function firstStart(event: Awaited<ReturnType<typeof getPublishedEvents>>[number]) {
  return event.event_sessions.map((session) => new Date(session.starts_at)).sort((a, b) => a.getTime() - b.getTime())[0]
}

export default async function CommunityPage() {
  const [metrics, people, resources, events, contributionIssueLinks] = await Promise.all([
    getPublicMemberMetrics(),
    getPublicPeople({ featured: true }),
    getPublishedResources(),
    getPublishedEvents(),
    getContributionIssueLinks(),
  ])
  const upcomingEvents = events.filter((event) => (firstStart(event)?.getTime() ?? 0) >= Date.now() && event.attendance_status !== 'closed')
  const audience = publicCommunityAudience(metrics.allTime)
  const eventProposalUrl = contributionIssueLinks[0].href

  return <main id="main-content" className="community-shell">
    <header className="community-hero" aria-labelledby="community-title">
      <div className="page-shell community-hero__grid">
        <div className="community-hero__content">
          <p className="eyebrow">Rein Community</p>
          <h1 id="community-title">A community of {audience}.</h1>
          <p className="community-hero__lead">Learn about AI Agents, meet thoughtful peers, and contribute to work that serves the public.</p>
          <div className="community-hero__actions"><Link href="#register" className="primary-action">Register for updates <Arrow /></Link><Link href="#contribute" className="quiet-action">Ways to contribute</Link></div>
        </div>
        <figure className="community-hero__figure"><img src={communityConvergence.src} alt="" width="1619" height="971" fetchPriority="high" /><figcaption>Paths converge / Community study</figcaption></figure>
      </div>
    </header>

    <CommunitySection eyebrow="01 / Participation" title="An open community with clear paths." lead="Most resources and public events are open to everyone. Registration is optional; Contributor applications are for deeper involvement.">
      <ol className="community-role-list">
        <li><span>01</span><div><small>Open by default</small><h3>Public Participant</h3></div><p>Access public learning resources and events without registering.</p></li>
        <li><span>02</span><div><small>Stay connected</small><h3>Community Participant</h3></div><p>Register your field and region for relevant community updates.</p></li>
        <li><span>03</span><div><small>Take responsibility</small><h3>Contributor</h3></div><p>Help organize activities or participate in ongoing work.</p></li>
        <li><span>04</span><div><small>Public stewardship</small><h3>Core Contributor</h3></div><p>Existing Contributors recognized for sustained responsibility.</p></li>
      </ol>
      <Link href="#contribute" className="text-action">Explore ways to contribute <Arrow /></Link>
    </CommunitySection>

    <CommunitySection eyebrow="02 / Community program" title="Learn and gather in public." lead="Free learning and public events, brought together as one community program." id="program" tone="soft">
      <div className="community-program-list">
        <article>
          <div><p className="article-kicker">Learn</p><h3>Free AI Agent learning.</h3><p>Courses, research briefings, paper discussions, and practical references.</p><Link href="/community/contribute/resources/submit" className="primary-action community-program-action">Submit a learning resource <Arrow /></Link></div>
          {resources.length ? <div className="resource-list">{resources.map((resource) => <article className="resource-card" key={resource.id}><span className="resource-card__meta">{resource.resource_type} · {resource.language}{resource.difficulty ? ` · ${resource.difficulty}` : ''}</span><h4>{resource.title}</h4><p>{resource.summary}</p><a href={resource.public_url} target="_blank" rel="noreferrer">Open resource <span aria-hidden="true">↗</span></a></article>)}</div> : null}
        </article>
        <article>
          <div><p className="article-kicker">Gather</p><h3>Online and local events.</h3><p>Discussions, campus activities, community gatherings, and conference events.</p><a href={eventProposalUrl} className="primary-action community-program-action" target="_blank" rel="noreferrer">Propose an event on GitHub <span aria-hidden="true">↗</span></a></div>
          {upcomingEvents.length ? <div className="event-list">{upcomingEvents.map((event) => { const start = firstStart(event); return <article className="event-card" key={event.id}><span className="event-card__meta">{event.format.replace('_', ' ')} · {event.attendance_status}</span><h4>{event.title}</h4><p>{event.summary}</p>{start ? <p className="field-hint">{new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: event.timezone }).format(start)}</p> : null}<Link href={`/community/gather/${event.slug}`}>Event details</Link></article> })}</div> : null}
        </article>
      </div>
    </CommunitySection>

    <CommunitySection eyebrow="03 / People" title="People behind the work." lead="Directors and Core Contributors from across the community." id="people">
      {people.length ? <div className="profile-grid">{people.map((person) => <ProfileCard person={person} key={person.id} />)}</div> : null}
    </CommunitySection>

    <CommunitySection eyebrow="04 / Stay connected" title="Register for community updates." lead="Receive new learning resources, event announcements, and opportunities relevant to your field and region." id="register" tone="soft">
      <ParticipantForm />
    </CommunitySection>

    <CommunitySection eyebrow="05 / Contribute" title="Choose how you want to contribute." lead="Join ongoing work, propose something in public, or share a useful learning resource." id="contribute">
      <ContributionPaths issueLinks={contributionIssueLinks} />
    </CommunitySection>
  </main>
}
