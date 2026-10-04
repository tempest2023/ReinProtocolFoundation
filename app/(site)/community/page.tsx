import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import communityConvergence from '@/src/assets/scenes/community-convergence.webp'
import { Arrow } from '@/components/icons'
import { CommunitySection } from '@/components/community-shell'
import { ContributionPaths, getContributionIssueLinks } from '@/components/contribution-paths'
import { ParticipantForm } from '@/components/forms/participant-form'
import { ProfileCard } from '@/components/profile-card'
import { getPublishedEvents, getPublishedResources, getPublicMemberMetrics, getPublicPeople } from '@/lib/community/data'
import { publicCommunityAudience } from '@/lib/community/presentation'

export const metadata: Metadata = { title: 'Community', description: 'Join in-person events and online conversations, share learning materials, and find peer guidance for a career working with AI agents.' }
export const maxDuration = 60

function firstStart(event: Awaited<ReturnType<typeof getPublishedEvents>>[number]) {
  return event.event_sessions.map((session) => new Date(session.starts_at)).sort((a, b) => a.getTime() - b.getTime())[0]
}

async function CommunityAudience() {
  const metrics = await getPublicMemberMetrics()
  return <>{publicCommunityAudience(metrics.allTime)}</>
}

async function CommunityProgram() {
  const [resources, events, contributionIssueLinks] = await Promise.all([
    getPublishedResources(),
    getPublishedEvents(),
    getContributionIssueLinks(),
  ])
  const upcomingEvents = events.filter((event) => (firstStart(event)?.getTime() ?? 0) >= Date.now() && event.attendance_status !== 'closed')
  const eventProposalUrl = contributionIssueLinks[0].href

  return (
    <div className="community-program-list">
      <article>
        <div><p className="article-kicker">01 / Meet in person</p><h3>In-person events.</h3><p>Meet people working with AI agents through local meetups, workshops, presentations, and discussions. Share a project, explore safety research, or help organize an event in your community.</p><a href={eventProposalUrl} className="primary-action community-program-action" target="_blank" rel="noreferrer">Propose an event on GitHub <span aria-hidden="true">↗</span></a></div>
      </article>
      <article>
        <div><p className="article-kicker">02 / Connect online</p><h3>Online community and learning.</h3><p>Continue the conversation in Slack and Discord, take part in online presentations and events, and exchange questions and ideas about AI agents.</p><p>Share learning materials, discuss research, and offer project feedback or career guidance to members preparing for AI agent roles. Bring your experience, whether you are new to the field or already working in it.</p><Link href="/community/contribute/resources/submit" className="primary-action community-program-action">Submit a learning resource <Arrow /></Link></div>
        {resources.length ? <div className="resource-list">{resources.map((resource) => <article className="resource-card" key={resource.id}><span className="resource-card__meta">{resource.resource_type} · {resource.language}{resource.difficulty ? ` · ${resource.difficulty}` : ''}</span><h4>{resource.title}</h4><p>{resource.summary}</p><a href={resource.public_url} target="_blank" rel="noreferrer">Open resource <span aria-hidden="true">↗</span></a></article>)}</div> : null}
      </article>
      {upcomingEvents.length ? <article><div><p className="article-kicker">Event calendar</p><h3>Upcoming events.</h3><p>Explore in-person, online, and hybrid sessions.</p></div><div className="event-list">{upcomingEvents.map((event) => { const start = firstStart(event); return <article className="event-card" key={event.id}><span className="event-card__meta">{event.format.replace('_', ' ')} · {event.attendance_status}</span><h4>{event.title}</h4><p>{event.summary}</p>{start ? <p className="field-hint">{new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: event.timezone }).format(start)}</p> : null}<Link href={`/community/gather/${event.slug}`}>Event details</Link></article> })}</div></article> : null}
    </div>
  )
}

async function CommunityPeople() {
  const people = await getPublicPeople({ featured: true })
  if (!people.length) return null
  return <div className="profile-grid">{people.map((person) => <ProfileCard person={person} key={person.id} />)}</div>
}

async function CommunityContribute() {
  const contributionIssueLinks = await getContributionIssueLinks()
  return <ContributionPaths issueLinks={contributionIssueLinks} />
}

function ProgramFallback() {
  return (
    <div className="community-program-list" aria-hidden="true">
      {[0, 1].map((index) => (
        <article key={index}>
          <div><span className="skeleton-line skeleton-line--kicker" /><span className="skeleton-line skeleton-line--title" /><span className="skeleton-line skeleton-line--bio skeleton-line--short" /></div>
        </article>
      ))}
    </div>
  )
}

function PeopleFallback() {
  return (
    <div className="profile-grid" aria-hidden="true">
      {[0, 1].map((index) => (
        <article className="profile-card" key={index}>
          <div className="profile-card__placeholder" />
          <div><span className="skeleton-line skeleton-line--role" /><span className="skeleton-line skeleton-line--name" /><span className="skeleton-line skeleton-line--bio" /><span className="skeleton-line skeleton-line--bio skeleton-line--short" /></div>
        </article>
      ))}
    </div>
  )
}

function ContributeFallback() {
  return (
    <ol className="contribution-list" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <li key={index}>
          <span className="skeleton-line skeleton-line--index" />
          <div><span className="skeleton-line skeleton-line--title" /><span className="skeleton-line skeleton-line--bio" /><span className="skeleton-line skeleton-line--bio skeleton-line--short" /></div>
        </li>
      ))}
    </ol>
  )
}

export default function CommunityPage() {
  return <main id="main-content" className="community-shell">
    <header className="community-hero" aria-labelledby="community-title">
      <div className="page-shell community-hero__grid">
        <div className="community-hero__content">
          <p className="eyebrow">Rein Community</p>
          <h1 id="community-title">A community of <Suspense fallback={<span className="audience-pending">many active participants</span>}><CommunityAudience /></Suspense>.</h1>
          <p className="community-hero__lead">Meet people working with AI agents, learn together at events and online, and help each other grow. Share your knowledge and find guidance for your next step in the field.</p>
          <div className="community-hero__actions"><Link href="#register" className="primary-action">Register for updates <Arrow /></Link><Link href="#contribute" className="quiet-action">Ways to contribute</Link></div>
        </div>
        <figure className="community-hero__figure"><img src={communityConvergence.src} alt="" width="1619" height="971" fetchPriority="high" /><figcaption>Paths converge / Community study</figcaption></figure>
      </div>
    </header>

    <CommunitySection eyebrow="01 / Participation" title="Start with a conversation, a resource, or an event." lead="You can explore public resources and events without registering for updates. Apply as a Contributor when you want to help organize or take responsibility for ongoing work.">
      <ol className="community-role-list">
        <li><span>01</span><div><small>Open by default</small><h3>Public Participant</h3></div><p>Access public learning resources and events without registering.</p></li>
        <li><span>02</span><div><small>Stay connected</small><h3>Community Participant</h3></div><p>Register your field and region for relevant community updates.</p></li>
        <li><span>03</span><div><small>Take responsibility</small><h3>Contributor</h3></div><p>Host an event, lead an online session, curate learning materials, or offer peer guidance.</p></li>
        <li><span>04</span><div><small>Public stewardship</small><h3>Core Contributor</h3></div><p>Existing Contributors recognized for sustained responsibility.</p></li>
      </ol>
      <Link href="#contribute" className="text-action">Explore ways to contribute <Arrow /></Link>
    </CommunitySection>

    <CommunitySection eyebrow="02 / Our early programs" title="Meet in person. Stay connected online." lead="Two connected priorities: local events and an online community for conversations, presentations, shared learning, and career guidance." id="program" tone="soft">
      <Suspense fallback={<ProgramFallback />}><CommunityProgram /></Suspense>
    </CommunitySection>

    <CommunitySection eyebrow="03 / People" title="People behind the work." lead="Directors and Core Contributors from across the community." id="people">
      <Suspense fallback={<PeopleFallback />}><CommunityPeople /></Suspense>
    </CommunitySection>

    <CommunitySection eyebrow="04 / Stay connected" title="Register for community updates." lead="Hear about local events, online presentations, learning materials, and ways to contribute, with updates relevant to your field and region." id="register" tone="soft">
      <ParticipantForm />
    </CommunitySection>

    <CommunitySection eyebrow="05 / Contribute" title="Choose how you want to contribute." lead="Organize an event, give a presentation, share learning materials, or help another member prepare for work with AI agents." id="contribute">
      <Suspense fallback={<ContributeFallback />}><CommunityContribute /></Suspense>
    </CommunitySection>
  </main>
}
