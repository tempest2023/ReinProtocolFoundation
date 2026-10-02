import Link from 'next/link'
import { Suspense } from 'react'
import sanFrancisco from '@/src/assets/scenes/san-francisco.webp'
import santaClara from '@/src/assets/scenes/santa-clara.webp'
import stanford from '@/src/assets/scenes/stanford.webp'
import paloAlto from '@/src/assets/scenes/palo-alto.webp'
import losAngeles from '@/src/assets/scenes/los-angeles.webp'
import { Arrow } from '@/components/icons'
import { ArticleHero, TextLink } from '@/components/primitives'
import { getPublicMemberMetrics, getPublicPeople } from '@/lib/community/data'
import { publicCommunityAudience } from '@/lib/community/presentation'

export const programs = [
  {
    number: '01', title: 'In-person events', short: 'Meet peers, share work, and explore AI agent development and safety.',
    detail: 'Local meetups, workshops, presentations, and discussions bring people working with AI agents into the same room. Members can share projects, discuss research, and find collaborators.',
    approach: 'We welcome member-led events in local communities, on campuses, and alongside research conferences. Events should be accessible and primarily free, with any conference affiliation stated accurately.',
  },
  {
    number: '02', title: 'Online community and learning', short: 'Keep the conversation going through group discussions, live sessions, and shared learning.',
    detail: 'Slack and Discord discussions, online presentations, and virtual events connect members across locations. Bring questions, share what you are working on, and learn about AI agent development, security, and safety together.',
    approach: 'Members are encouraged to contribute learning materials, lead discussions, and offer practical guidance to peers moving into AI agent roles. Sharing project feedback, study resources, and career experience helps more people participate in the field.',
  },
]

const fundPath = [
  { label: 'Accept', text: 'Only through verified channels and approved assets.' },
  { label: 'Safeguard', text: 'Segregated custody, policy limits and accountable signers.' },
  { label: 'Allocate', text: 'Mission budgets governed by humans, DAO and policy.' },
  { label: 'Publish', text: 'Transactions, decisions, expenses and outcomes.' },
]

const governanceActors = [
  { label: 'Human Board', role: 'Legally accountable', text: 'Fiduciary duties, legal standing, people, major direction and Agent oversight.' },
  { label: 'DAO', role: 'Collectively governing', text: 'One authenticated collective governance vote within the adopted constitution.' },
  { label: 'AI Agents', role: 'Operating by default', text: 'Planning, research, reporting and policy-bound program execution.' },
]

const disclosureCadence = [
  ['Live', 'Wallets, material transactions, proposals and votes'],
  ['Monthly', 'Treasury movement, expenses, programs and Agent activity'],
  ['Quarterly', 'Budget, outcomes, risks, failures and control improvements'],
  ['Annual', 'Financial, governance, impact and filing record'],
]

async function HomeAudience() {
  const metrics = await getPublicMemberMetrics()
  return <>{publicCommunityAudience(metrics.allTime)}</>
}

async function HomeFeaturedPeople() {
  const people = await getPublicPeople({ featured: true })
  if (!people.length) return null
  return (
    <div className="profile-grid" style={{ marginTop: '4rem' }}>
      {people.map((person) => <article className="profile-card" key={person.id}>{person.photo_url ? <img className="profile-card__portrait" src={person.photo_url} alt={person.photo_alt ?? ''} /> : <div className="profile-card__placeholder" aria-hidden="true">{person.display_name.slice(0, 1)}</div>}<div><p className="profile-card__role">{person.role}</p><h2>{person.display_name}</h2><p className="profile-card__bio">{person.biography}</p></div></article>)}
    </div>
  )
}

function HomePeopleFallback() {
  return (
    <div className="profile-grid" style={{ marginTop: '4rem' }} aria-hidden="true">
      {[0, 1].map((index) => (
        <article className="profile-card" key={index}>
          <div className="profile-card__placeholder" />
          <div><span className="skeleton-line skeleton-line--role" /><span className="skeleton-line skeleton-line--name" /><span className="skeleton-line skeleton-line--bio" /><span className="skeleton-line skeleton-line--bio skeleton-line--short" /></div>
        </article>
      ))}
    </div>
  )
}

export function InstitutionalHomePage() {
  return (
    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__art" aria-hidden="true"><img src={sanFrancisco.src} alt="" width="971" height="1619" fetchPriority="high" /></div>
        <div className="home-hero__content page-shell">
          <p className="eyebrow hero-enter hero-enter--1">A NONPROFIT ORGANIZATION FOR AI AGENT SAFETY</p>
          <h1 id="home-title">Making AI agents safer <em>for people and society.</em></h1>
          <p className="home-hero__mission hero-enter hero-enter--3">We bring people together and support open-source projects and research to make AI agents safer.</p>
          <div className="home-hero__actions hero-enter hero-enter--4">
            <Link href="/mission" className="primary-action">Read our mission <Arrow /></Link>
            <Link href="/community" className="quiet-action">Explore the community</Link>
          </div>
        </div>
        <div className="home-hero__principles page-shell hero-enter hero-enter--5" aria-label="Founding principles"><span>Open participation</span><span>Agent operated</span><span>Human accountable</span></div>
      </section>

      <section className="position-section" id="mission" aria-labelledby="position-title">
        <div className="page-shell position-grid">
          <p className="section-index" data-reveal>01 / Why agent safety</p>
          <div data-reveal><h2 id="position-title">AI agents act in the real world.</h2><p className="position-lead">Agents use tools, access systems, and carry out tasks. We support the research, open-source work, and shared knowledge that help people understand and oversee those actions.</p></div>
          <div className="value-line" data-reveal>
            <div><strong>Security</strong><span>Set clear limits on access and permissions.</span></div>
            <div><strong>Visibility</strong><span>Understand what agents do and why.</span></div>
            <div><strong>Oversight</strong><span>Detect problems and intervene when needed.</span></div>
          </div>
          <TextLink href="/mission" light>Read the mission in full</TextLink>
        </div>
      </section>

      <section className="work-section" id="programs" aria-labelledby="work-title">
        <div className="work-visual" aria-hidden="true" data-reveal><img className="deferred-image is-loaded" src={stanford.src} width="972" height="1619" alt="" loading="lazy" /><span>Knowledge bears duty</span></div>
        <div className="work-content" data-reveal>
          <p className="section-index">02 / Our early programs</p><h2 id="work-title">Meet in person. Keep learning together online.</h2>
          <ol className="work-list">{programs.map((program) => <li key={program.number}><span>{program.number}</span><div><strong>{program.title}</strong><p>{program.short}</p></div></li>)}</ol>
          <TextLink href="/programs">Explore our programs</TextLink>
        </div>
      </section>

      <section className="stewardship-section" id="governance" aria-labelledby="stewardship-title">
        <div className="stewardship-art" aria-hidden="true"><img className="deferred-image is-loaded" src={paloAlto.src} width="971" height="1619" alt="" loading="lazy" /></div>
        <div className="page-shell stewardship-content">
          <div className="stewardship-heading" data-reveal><p className="section-index section-index--light">03 / How we operate</p><h2 id="stewardship-title">Agent operated. Human accountable.</h2><p>We use AI agents to help run and grow Rein. Our governance model sets limits on their authority and defines how decisions, funds, and outcomes are reviewed.</p></div>
          <ol className="fund-path" data-reveal>{fundPath.map((step, index) => <li key={step.label}><span>0{index + 1}</span><strong>{step.label}</strong><p>{step.text}</p></li>)}</ol>
          <div className="accountability-line" data-reveal><p><strong>Human Board</strong> carries legal accountability.</p><p><strong>DAO</strong> participates through one collective vote.</p><p><strong>AI Agents</strong> execute within visible policy.</p></div>
          <TextLink href="/governance" light>Inspect the governance model</TextLink>
        </div>
      </section>

      <section className="community-section community-section--soft" aria-labelledby="home-community-title">
        <div className="page-shell">
          <div className="community-heading"><p className="section-index">04 / Community</p><div><h2 id="home-community-title">A public network of <Suspense fallback={<span className="audience-pending">many active participants</span>}><HomeAudience /></Suspense>.</h2><p>Meet people working with AI agents, join local and online events, share learning materials, and help each other prepare for AI agent roles.</p><TextLink href="/community">Enter the community</TextLink></div></div>
          <Suspense fallback={<HomePeopleFallback />}>
            <HomeFeaturedPeople />
          </Suspense>
        </div>
      </section>

      <section className="giving-section" id="giving" aria-labelledby="giving-title">
        <div className="giving-art" aria-hidden="true" data-reveal><img className="deferred-image is-loaded" src={losAngeles.src} width="971" height="1619" alt="" loading="lazy" /></div>
        <div className="giving-content" data-reveal><p className="section-index">05 / Giving</p><h2 id="giving-title">Support the community advancing agent safety.</h2><p className="giving-lead">Our funding priorities include accessible events, shared learning, open-source projects, and safety research. Giving channels remain subject to legal and operational approval.</p><div className="giving-standard"><span>Foundation status</span><strong>Legal formation under review.</strong></div><p className="asset-summary">Community events · Shared learning · Open source · Research</p><TextLink href="/giving">Review our giving standards</TextLink></div>
      </section>

      <section className="closing-section" aria-labelledby="closing-title"><div className="page-shell" data-reveal><p className="eyebrow">Take part</p><h2 id="closing-title">Help make AI agents safer for people and society.</h2><Link href="/community" className="closing-link">Find your place in the community <Arrow /></Link></div></section>
    </main>
  )
}

function ArticleLayout({ summaryLabel, summary, children }: { summaryLabel: string; summary: string; children: React.ReactNode }) {
  return <section className="article-body"><div className="page-shell article-layout"><aside className="article-rail"><span>{summaryLabel}</span><p>{summary}</p></aside><article className="article-copy">{children}</article></div></section>
}

export function MissionPage() {
  return <main id="main-content"><ArticleHero eyebrow="Our mission" title="Making AI agents safer for people and society." lead="Rein supports AI agent development through community, open-source projects, and security and safety research. We want people to benefit from agents they can understand and oversee." image={santaClara} imagePosition="50% 58%" caption="Institutional memory / Santa Clara" />
    <ArticleLayout summaryLabel="Our focus" summary="Support AI agent development and the people, research, and open infrastructure that make it safer.">
      <p className="article-standfirst" data-reveal>AI agents connect language models to tools, software, and real tasks. That ability to act makes security, visibility, and oversight essential parts of their development.</p>
      <section id="constructive" data-reveal><p className="article-kicker">01 / Community and participation</p><h2>Help more people participate in AI agent development.</h2><p>Rein brings learners, researchers, and practitioners together to share knowledge and work on agent safety. Our role as a nonprofit includes supporting open-source projects, research, public discussion, and access to learning.</p><p>Members can meet at events, exchange ideas online, contribute learning materials, and guide peers moving into AI agent roles. These relationships help people turn an interest in the field into informed participation.</p></section>
      <section id="protective" data-reveal><p className="article-kicker">02 / Security, visibility, and oversight</p><h2>Understand what agents do. Keep their actions accountable.</h2><p>Agent safety includes the systems around a language model: the harness that coordinates its work, the tools it can use, and the permissions it receives. We support work that makes those systems easier to inspect, test, and supervise.</p><p>Our areas of interest include monitoring agent behavior, detecting security threats and failures, explaining actions, and enabling human intervention. The long-term goal is to prevent serious harm to people and society as agents take on greater responsibilities.</p></section>
      <blockquote className="article-proposition" data-reveal>We believe AI agents can help monitor and supervise other agents, with people setting the rules and remaining accountable.</blockquote>
      <section id="practice" data-reveal><p className="article-kicker">03 / An AI-native organization</p><h2>Use agents to advance agent safety.</h2><p>We use AI agents to help operate and grow Rein. Applying them to research, coordination, and oversight also helps us understand the safety infrastructure an agent-operated organization needs.</p><p>Our early programs focus on in-person events and an online community for discussions, presentations, shared learning, and career guidance. These activities support a broader mission of open-source development and safety research.</p><TextLink href="/programs">Explore our early programs</TextLink></section>
    </ArticleLayout>
  </main>
}

export function ProgramsPage() {
  return <main id="main-content"><ArticleHero eyebrow="Our early programs" title="Meet in person. Keep learning together online." lead="Our early work has two priorities: in-person events and an online community. Both help people learn about AI agents, share their work, and take part in making agents safer." image={stanford} imagePosition="50% 58%" caption="Knowledge and duty / Stanford" />
    <ArticleLayout summaryLabel="Two connected priorities" summary="Meet through local events, then continue the exchange through online discussions, presentations, shared resources, and peer guidance.">
      <p className="article-standfirst" data-reveal>Community is the starting point for Rein’s work. We want members to learn from one another, find collaborators, and develop the knowledge and experience to contribute to AI agent development and safety.</p>
      <div className="program-essay-list">{programs.map((program) => <section key={program.number} data-reveal><span>{program.number}</span><div><p className="article-kicker">{program.short}</p><h2>{program.title}</h2><p>{program.detail}</p><p>{program.approach}</p></div></section>)}</div>
      <aside className="article-inset" data-reveal><p className="article-kicker">Contribute your experience</p><h2>Help someone take their next step into AI agents.</h2><p>Share a tutorial or reading list, give a presentation, review a peer’s project, or offer guidance from your own career. Members from different backgrounds can help one another identify skills to learn and prepare for roles working with AI agents.</p><TextLink href="/community#contribute">Find a way to contribute</TextLink></aside>
      <section data-reveal><p className="article-kicker">Connection to our mission</p><h2>Grow participation in agent safety.</h2><p>Events and online exchange help people discover safety research, contribute to open-source projects, and learn how agents behave in practice. Our broader work includes supporting research and open infrastructure for agent security, monitoring, and oversight.</p><TextLink href="/community#program">Explore community activities</TextLink></section>
    </ArticleLayout>
  </main>
}

export function GovernancePage() {
  return <main id="main-content"><ArticleHero eyebrow="Governance and stewardship" title="AI agents help run Rein. People remain responsible." lead="Our governance model defines who sets direction, what agents may do, and how their work is reviewed. Human oversight supports the community and its mission." image={paloAlto} imagePosition="50% 62%" caption="Shared systems / Palo Alto Baylands" />
    <ArticleLayout summaryLabel="Constitutional principle" summary="Automate operations wherever responsible; never automate away legal duty, human judgment or the ability to intervene.">
      <p className="article-standfirst" data-reveal>Rein is an AI-native organization. Agents help with research, coordination, and operations within defined permissions. People remain responsible for the mission, resources, and decisions that require human judgment.</p>
      <section data-reveal><p className="article-kicker">01 / Responsibility map</p><h2>Who decides, who acts, and who reviews.</h2><p>The Board, community governance, and agents have distinct roles in the founding model. Using agents to monitor other agents still requires clear authority and a path for human intervention.</p><div className="actor-ledger">{governanceActors.map((actor, index) => <div key={actor.label}><span>0{index + 1}</span><div><strong>{actor.label}</strong><small>{actor.role}</small></div><p>{actor.text}</p></div>)}</div></section>
      <aside className="article-inset" data-reveal><p className="article-kicker">Governance vote architecture</p><h2>Community voice enters a legally accountable process.</h2><p>Each natural-person director has one vote. The authenticated DAO community produces one collective governance vote with equal policy weight, subject to nonprofit law and nondelegable fiduciary duties.</p></aside>
      <section data-reveal><p className="article-kicker">02 / Stewardship path</p><h2>From accepted gift to visible outcome.</h2><ol className="article-process">{fundPath.map((step, index) => <li key={step.label}><span>0{index + 1}</span><div><strong>{step.label}</strong><p>{step.text}</p></div></li>)}</ol><p>Charitable assets remain Foundation property. They do not become donor property, Token-holder property or a private protocol treasury.</p></section>
      <section data-reveal><p className="article-kicker">03 / Publication cadence</p><h2>Trust is a reporting system.</h2><dl className="article-cadence">{disclosureCadence.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl><TextLink href="/giving">Review the giving model</TextLink></section>
    </ArticleLayout>
  </main>
}

export function GivingPage() {
  return <main id="main-content"><ArticleHero eyebrow="Supporting the mission" title="Support AI agent safety and community." lead="Our funding priorities include accessible events, shared learning, open-source projects, and safety research. Giving channels are subject to legal and operational approval." image={losAngeles} imagePosition="50% 100%" caption="Looking beyond / Los Angeles" />
    <ArticleLayout summaryLabel="Official-channel policy" summary="The Foundation’s legal formation and giving channels remain under review. Do not send contributions until verified channels and their terms are published.">
      <p className="article-standfirst" data-reveal>Support for Rein would help members meet, learn, share their work, and contribute to agent safety. The giving model below explains how contributions would be accepted, managed, and reported.</p>
      <aside className="article-inset" data-reveal><p className="article-kicker">Official channels</p><h2>Giving will use verified Foundation channels once approved.</h2><p>No wallet address or payment link is authorized here yet. Future official channels must publish their network, asset, custody and receipt details and meet gift-acceptance, screening and accounting controls.</p></aside>
      <section data-reveal><p className="article-kicker">01 / Giving rails</p><h2>Broad access. Asset-by-asset control.</h2><div className="giving-ledger"><div><span>Core digital assets</span><strong>BTC · ETH · BNB</strong><p>Accepted only on specifically approved networks and through published Foundation-controlled addresses.</p></div><div><span>Stable and conventional</span><strong>Approved stablecoins · ACH · cards · wires</strong><p>We recommend lower-cost routes when fees would consume a disproportionate share of a gift.</p></div><div><span>Reviewed assets</span><strong>Exchange-issued tokens · Meme Coins · other assets</strong><p>Individual review for liquidity, custody, contract, compliance, accounting and liquidation risk.</p></div></div></section>
      <aside className="article-inset" data-reveal><p className="article-kicker">Accounting rule</p><h2>A gift and its later investment result are not the same thing.</h2><div className="receipt-steps"><p><span>At receipt</span>Record quantity, chain, timestamp and defensible fair value.</p><p><span>After receipt</span>Report appreciation or loss separately from donation revenue.</p><p><span>For the donor</span>Describe donated property; do not promise or assign the donor’s tax value.</p></div></aside>
      <section data-reveal><p className="article-kicker">02 / Operational controls</p><h2>Five controls govern every gift.</h2><ol className="article-process"><li><span>01</span><strong>Legal authority and Board oversight</strong></li><li><span>02</span><strong>Custody and signer controls</strong></li><li><span>03</span><strong>Gift acceptance and screening</strong></li><li><span>04</span><strong>Accounting and receipts</strong></li><li><span>05</span><strong>Public addresses and reporting</strong></li></ol><TextLink href="/governance">See the stewardship model</TextLink></section>
    </ArticleLayout>
  </main>
}
