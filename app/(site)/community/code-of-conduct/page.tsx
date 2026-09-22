import type { Metadata } from 'next'
import Link from 'next/link'
import { getPublicSiteSettings } from '@/lib/community/data'

export const metadata: Metadata = { title: 'Community Code of Conduct', description: 'The communication and safety standards for the Rein community.' }

export default async function CodeOfConductPage() {
  const settings = await getPublicSiteSettings(['email_identity'])
  const contact = settings.email_identity
  return <main id="main-content" className="community-shell"><article className="legal-copy page-shell"><p className="eyebrow">Community standard</p><h1>Code of Conduct</h1><p className="form-intro__lead">Rein welcomes people across industries, educational backgrounds, nationalities, professional paths, technical experience, political views, and public influence. We protect that openness with specific communication and safety boundaries.</p>
    <section><h2>Expected conduct</h2><ul><li>Engage people and ideas with basic respect, including when disagreement is direct.</li><li>Describe affiliations, experience, and proposed work honestly.</li><li>Respect privacy, event-safety instructions, and reasonable communication boundaries.</li><li>Critique the Mission, organization, or technical assumptions without targeting people for abuse.</li><li>Raise safety concerns through the published contact channel.</li></ul></section>
    <section><h2>Conduct that is not accepted</h2><ul><li>Explicit threats or encouragement of violence against people, groups, or events.</li><li>Hate, targeted harassment, sustained insults, or intimidation.</li><li>Fraud, impersonation, or malicious social engineering.</li><li>Doxxing, deliberate disruption of event safety, or explicit sabotage plans.</li><li>Persistent refusal to respect basic communication and safety boundaries.</li></ul></section>
    <section><h2>How decisions are made</h2><p>We base restrictions and rejections on documented conduct, not vague labels. Ordinary disagreement, criticism of the Mission, political or cultural background, industry or employment history, limited English fluency, and blunt or awkward phrasing are not by themselves violations.</p></section>
    <section><h2>Scope and reporting</h2><p>This Code applies to Rein-managed online spaces, events, applications, and direct organizational communication. It does not create legal membership or an employment relationship.</p><p>{contact ? <>Report a concern to <a href={`mailto:${contact}`}>{contact}</a>. </> : 'Report concerns through Rein’s official contact channel. '}Include only information needed to understand the issue.</p><p><Link href="/community">Return to Community</Link></p></section>
  </article></main>
}
