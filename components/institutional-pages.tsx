import Link from 'next/link'
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
    number: '01', title: 'Make AI legible', short: 'Public education and an independent voice inside AI communities.',
    detail: 'Publish accessible research interpretation, public forums, interviews and multilingual material that help more people understand beneficial and safe AI Agents.',
    approach: 'The work translates technical progress without flattening uncertainty. It connects model capability, Agent behavior, governance and social consequence so that public participation can begin before decisions become irreversible.',
  },
  {
    number: '02', title: 'Convene the field', short: 'Independent events around the places where AI research gathers.',
    detail: 'Organize workshops, panels and community events around ICML, NeurIPS, ICLR, ACL and related research communities, with accurate affiliation language.',
    approach: 'Convenings bring researchers, builders, educators and public-interest practitioners into the same room. The Foundation participates independently and describes every institutional relationship precisely.',
  },
  {
    number: '03', title: 'Teach openly', short: 'Free paths into AI, LLMs and responsible Agent development.',
    detail: 'Create open courses, curricula, practical projects, reading groups and mentorship that widen access to research and responsible industry work.',
    approach: 'Learning paths combine conceptual foundations with responsible practice. Materials are designed for reuse, translation and adaptation by communities that are usually downstream of technical change.',
  },
  {
    number: '04', title: 'Build civic community', short: 'Primarily free online and local spaces for learning and action.',
    detail: 'Connect learners, researchers and builders through cohorts, local gatherings and public discussions on Agent safety, infrastructure and social impact.',
    approach: 'Community is treated as civic infrastructure: a place to learn, deliberate and act together. Participation should remain broadly accessible rather than becoming a premium gate around public knowledge.',
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

export async function InstitutionalHomePage() {
  const [metrics, people] = await Promise.all([getPublicMemberMetrics(), getPublicPeople({ featured: true })])
  const audience = publicCommunityAudience(metrics.allTime)
  return (
    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__art" aria-hidden="true"><img src={sanFrancisco.src} alt="" width="971" height="1619" fetchPriority="high" /></div>
        <div className="home-hero__content page-shell">
          <p className="eyebrow hero-enter hero-enter--1">A public institution for the Agent age</p>
          <h1 id="home-title">AI Agents should enlarge human possibility—<em>not erase it.</em></h1>
          <p className="home-hero__mission hero-enter hero-enter--3">We advance beneficial AI Agents, widen access to AI knowledge, and build safeguards against catastrophic harm from AGI and ASI.</p>
          <div className="home-hero__actions hero-enter hero-enter--4">
            <Link href="/mission" className="primary-action">Read our mission <Arrow /></Link>
            <Link href="/governance" className="quiet-action">How trust is designed</Link>
          </div>
        </div>
        <div className="home-hero__principles page-shell hero-enter hero-enter--5" aria-label="Founding principles"><span>Web3 first</span><span>Agent operated</span><span>Human accountable</span></div>
      </section>

      <section className="position-section" id="mission" aria-labelledby="position-title">
        <div className="page-shell position-grid">
          <p className="section-index" data-reveal>01 / Our position</p>
          <div data-reveal><h2 id="position-title">Intelligence is becoming public power.</h2><p className="position-lead">It should serve human flourishing, preserve human agency, and remain answerable to the society it transforms.</p></div>
          <div className="value-line" data-reveal>
            <div><strong>Benefit</strong><span>Direct capability toward public good.</span></div>
            <div><strong>Agency</strong><span>Protect humanity’s ability to choose.</span></div>
            <div><strong>Proof</strong><span>Make power, money and outcomes inspectable.</span></div>
          </div>
          <TextLink href="/mission" light>Read the mission in full</TextLink>
        </div>
      </section>

      <section className="work-section" id="programs" aria-labelledby="work-title">
        <div className="work-visual" aria-hidden="true" data-reveal><img className="deferred-image is-loaded" src={stanford.src} width="972" height="1619" alt="" loading="lazy" /><span>Knowledge bears duty</span></div>
        <div className="work-content" data-reveal>
          <p className="section-index">02 / What we do</p><h2 id="work-title">Public learning turns capability into shared power.</h2>
          <ol className="work-list">{programs.map((program) => <li key={program.number}><span>{program.number}</span><div><strong>{program.title}</strong><p>{program.short}</p></div></li>)}</ol>
          <TextLink href="/programs">Explore our programs</TextLink>
        </div>
      </section>

      <section className="stewardship-section" id="governance" aria-labelledby="stewardship-title">
        <div className="stewardship-art" aria-hidden="true"><img className="deferred-image is-loaded" src={paloAlto.src} width="971" height="1619" alt="" loading="lazy" /></div>
        <div className="page-shell stewardship-content">
          <div className="stewardship-heading" data-reveal><p className="section-index section-index--light">03 / Stewardship</p><h2 id="stewardship-title">Every gift has a public path.</h2><p>Money moves through controls—not a black box.</p></div>
          <ol className="fund-path" data-reveal>{fundPath.map((step, index) => <li key={step.label}><span>0{index + 1}</span><strong>{step.label}</strong><p>{step.text}</p></li>)}</ol>
          <div className="accountability-line" data-reveal><p><strong>Human Board</strong> carries legal accountability.</p><p><strong>DAO</strong> participates through one collective vote.</p><p><strong>AI Agents</strong> execute within visible policy.</p></div>
          <TextLink href="/governance" light>Inspect the governance model</TextLink>
        </div>
      </section>

      <section className="community-section community-section--soft" aria-labelledby="home-community-title">
        <div className="page-shell">
          <div className="community-heading"><p className="section-index">04 / Community</p><div><h2 id="home-community-title">A public network of {audience}.</h2><p>Learn about AI Agents, join public events, and contribute to work that serves the public.</p><TextLink href="/community">Enter the community</TextLink></div></div>
          {people.length ? <div className="profile-grid" style={{ marginTop: '4rem' }}>{people.map((person) => <article className="profile-card" key={person.id}>{person.photo_url ? <img className="profile-card__portrait" src={person.photo_url} alt={person.photo_alt ?? ''} /> : <div className="profile-card__placeholder" aria-hidden="true">{person.display_name.slice(0, 1)}</div>}<div><p className="profile-card__role">{person.role}</p><h2>{person.display_name}</h2><p className="profile-card__bio">{person.biography}</p></div></article>)}</div> : null}
        </div>
      </section>

      <section className="giving-section" id="giving" aria-labelledby="giving-title">
        <div className="giving-art" aria-hidden="true" data-reveal><img className="deferred-image is-loaded" src={losAngeles.src} width="971" height="1619" alt="" loading="lazy" /></div>
        <div className="giving-content" data-reveal><p className="section-index">05 / Giving</p><h2 id="giving-title">Giving is built on operational trust.</h2><p className="giving-lead">Our proposed giving rails would serve people and Agents through verified channels, subject to legal, custody, screening and accounting controls.</p><div className="giving-standard"><span>Foundation status</span><strong>Legal formation under review.</strong></div><p className="asset-summary">BTC · ETH · BNB · approved stablecoins · reviewed assets · fiat rails</p><TextLink href="/giving">Review our giving standards</TextLink></div>
      </section>

      <section className="closing-section" aria-labelledby="closing-title"><div className="page-shell" data-reveal><p className="eyebrow">Our long view</p><h2 id="closing-title">Rein makes public benefit a native capability of autonomous systems.</h2><Link href="/mission" className="closing-link">The future we are building <Arrow /></Link></div></section>
    </main>
  )
}

function ArticleLayout({ summaryLabel, summary, children }: { summaryLabel: string; summary: string; children: React.ReactNode }) {
  return <section className="article-body"><div className="page-shell article-layout"><aside className="article-rail"><span>{summaryLabel}</span><p>{summary}</p></aside><article className="article-copy">{children}</article></div></section>
}

export function MissionPage() {
  return <main id="main-content"><ArticleHero eyebrow="Mission and public work" title="Build benefit. Prevent catastrophe." lead="Rein Protocol exists to make AI Agents more useful to humanity—and increasingly capable systems less able to destroy what humanity values." image={santaClara} imagePosition="50% 58%" caption="Institutional memory / Santa Clara" />
    <ArticleLayout summaryLabel="Mission note" summary="Two obligations guide one institution: create measurable public benefit and preserve humanity’s ability to govern its future.">
      <p className="article-standfirst" data-reveal>Advanced AI is not only a technical achievement. It is a redistribution of capability, power and risk. Our mission begins from the premise that institutions must shape that transition deliberately—and remain accountable for the consequences.</p>
      <section id="constructive" data-reveal><p className="article-kicker">01 / Constructive obligation</p><h2>Help Agents create public good.</h2><p>Beneficial capability should be legible and broadly usable. We widen access to knowledge, support responsible research and build practical paths for AI Agents to serve people, communities and public-interest institutions.</p><p>This means treating education, open technology and civic participation as core infrastructure. A society cannot govern powerful systems if only a narrow technical class can understand or influence them.</p></section>
      <section id="protective" data-reveal><p className="article-kicker">02 / Protective obligation</p><h2>Keep the worst outcomes from becoming irreversible.</h2><p>As systems become more autonomous and capable, the cost of weak safeguards grows. The Foundation works to protect human life, agency, institutions and society’s ability to choose its own future in an AGI and ASI era.</p><p>Protection is not a separate pessimistic agenda. It is the condition that makes durable benefit possible: capability must remain answerable to human purposes, visible governance and enforceable limits.</p></section>
      <blockquote className="article-proposition" data-reveal>Rein makes public benefit a native capability of autonomous systems.</blockquote>
      <section id="practice" data-reveal><p className="article-kicker">03 / From principle to practice</p><h2>Mission becomes credible through public work.</h2><p>Programs translate the mission into education, convening, open learning and civic community. Governance translates it into responsibility: identifiable fiduciaries, bounded Agent authority, inspectable decisions and published outcomes.</p><TextLink href="/programs">Read the programs</TextLink></section>
    </ArticleLayout>
  </main>
}

export function ProgramsPage() {
  return <main id="main-content"><ArticleHero eyebrow="Programs and public work" title="Knowledge becomes public capacity." lead="Four connected programs turn the Foundation’s mission into work people can learn from, participate in and hold accountable." image={stanford} imagePosition="50% 58%" caption="Knowledge and duty / Stanford" />
    <ArticleLayout summaryLabel="Program model" summary="Public education, field-building, open learning and civic community reinforce one another rather than operating as isolated projects.">
      <p className="article-standfirst" data-reveal>The Foundation begins where public understanding and technical capability meet. Each program is designed to produce reusable knowledge, stronger participation and a clearer path from AI progress to human benefit.</p>
      <div className="program-essay-list">{programs.map((program) => <section key={program.number} data-reveal><span>{program.number}</span><div><p className="article-kicker">{program.short}</p><h2>{program.title}</h2><p>{program.detail}</p><p>{program.approach}</p></div></section>)}</div>
      <aside className="article-inset" data-reveal><p className="article-kicker">Use of funds</p><h2>Programs first. Infrastructure in service of programs.</h2><ul><li>Education, curriculum and public research</li><li>Events, access, translation and community support</li><li>Open-source and public-benefit technology</li><li>Qualified people and operating AI systems</li><li>Legal, accounting, security and compliance</li></ul></aside>
      <TextLink href="/governance">See how the work is governed</TextLink>
    </ArticleLayout>
  </main>
}

export function GovernancePage() {
  return <main id="main-content"><ArticleHero eyebrow="Governance and stewardship" title="Power should leave a record." lead="The organization is designed for Agent operation without anonymous authority: legal responsibility stays visible, community governance has a defined place and every material action should be inspectable." image={paloAlto} imagePosition="50% 62%" caption="Shared systems / Palo Alto Baylands" />
    <ArticleLayout summaryLabel="Constitutional principle" summary="Automate operations wherever responsible; never automate away legal duty, human judgment or the ability to intervene.">
      <p className="article-standfirst" data-reveal>Agent operation is meaningful only when authority is bounded and attributable. Rein separates execution, collective participation and fiduciary responsibility so that no system or constituency can quietly become sovereign.</p>
      <section data-reveal><p className="article-kicker">01 / Responsibility map</p><h2>Distributed intelligence. Located accountability.</h2><p>Different actors contribute different forms of judgment. Their roles overlap enough to challenge one another, but not enough to dissolve responsibility.</p><div className="actor-ledger">{governanceActors.map((actor, index) => <div key={actor.label}><span>0{index + 1}</span><div><strong>{actor.label}</strong><small>{actor.role}</small></div><p>{actor.text}</p></div>)}</div></section>
      <aside className="article-inset" data-reveal><p className="article-kicker">Governance vote architecture</p><h2>Community voice enters a legally accountable process.</h2><p>Each natural-person director has one vote. The authenticated DAO community produces one collective governance vote with equal policy weight, subject to nonprofit law and nondelegable fiduciary duties.</p></aside>
      <section data-reveal><p className="article-kicker">02 / Stewardship path</p><h2>From accepted gift to visible outcome.</h2><ol className="article-process">{fundPath.map((step, index) => <li key={step.label}><span>0{index + 1}</span><div><strong>{step.label}</strong><p>{step.text}</p></div></li>)}</ol><p>Charitable assets remain Foundation property. They do not become donor property, Token-holder property or a private protocol treasury.</p></section>
      <section data-reveal><p className="article-kicker">03 / Publication cadence</p><h2>Trust is a reporting system.</h2><dl className="article-cadence">{disclosureCadence.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl><TextLink href="/giving">Review the giving model</TextLink></section>
    </ArticleLayout>
  </main>
}

export function GivingPage() {
  return <main id="main-content"><ArticleHero eyebrow="Giving architecture" title="Native to the Agent economy. Bound to charitable law." lead="Rein is designing verified channels for conventional and digital-asset gifts, subject to legal and operational approval." image={losAngeles} imagePosition="50% 100%" caption="Looking beyond / Los Angeles" />
    <ArticleLayout summaryLabel="Official-channel policy" summary="The Foundation’s legal formation and giving channels remain under review. Do not send contributions until verified channels and their terms are published.">
      <p className="article-standfirst" data-reveal>A contribution is not simply a transaction. It creates a charitable asset, a custody obligation, an accounting record and a public responsibility that must remain coherent across fiat and digital rails.</p>
      <aside className="article-inset" data-reveal><p className="article-kicker">Official channels</p><h2>Giving will use verified Foundation channels once approved.</h2><p>No wallet address or payment link is authorized here yet. Future official channels must publish their network, asset, custody and receipt details and meet gift-acceptance, screening and accounting controls.</p></aside>
      <section data-reveal><p className="article-kicker">01 / Giving rails</p><h2>Broad access. Asset-by-asset control.</h2><div className="giving-ledger"><div><span>Core digital assets</span><strong>BTC · ETH · BNB</strong><p>Accepted only on specifically approved networks and through published Foundation-controlled addresses.</p></div><div><span>Stable and conventional</span><strong>Approved stablecoins · ACH · cards · wires</strong><p>We recommend lower-cost routes when fees would consume a disproportionate share of a gift.</p></div><div><span>Reviewed assets</span><strong>Exchange-issued tokens · Meme Coins · other assets</strong><p>Individual review for liquidity, custody, contract, compliance, accounting and liquidation risk.</p></div></div></section>
      <aside className="article-inset" data-reveal><p className="article-kicker">Accounting rule</p><h2>A gift and its later investment result are not the same thing.</h2><div className="receipt-steps"><p><span>At receipt</span>Record quantity, chain, timestamp and defensible fair value.</p><p><span>After receipt</span>Report appreciation or loss separately from donation revenue.</p><p><span>For the donor</span>Describe donated property; do not promise or assign the donor’s tax value.</p></div></aside>
      <section data-reveal><p className="article-kicker">02 / Operational controls</p><h2>Five controls govern every gift.</h2><ol className="article-process"><li><span>01</span><strong>Legal authority and Board oversight</strong></li><li><span>02</span><strong>Custody and signer controls</strong></li><li><span>03</span><strong>Gift acceptance and screening</strong></li><li><span>04</span><strong>Accounting and receipts</strong></li><li><span>05</span><strong>Public addresses and reporting</strong></li></ol><TextLink href="/governance">See the stewardship model</TextLink></section>
    </ArticleLayout>
  </main>
}
