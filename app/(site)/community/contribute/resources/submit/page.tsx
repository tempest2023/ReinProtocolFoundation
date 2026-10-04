import type { Metadata } from 'next'
import { ResourceSubmissionForm } from '@/components/forms/resource-form'

export const metadata: Metadata = { title: 'Submit a Learning Resource', description: 'Submit a free public AI Agent learning or technical resource for review.' }
export const maxDuration = 120

export default function SubmitResourcePage() {
  return <main id="main-content" className="community-shell"><div className="page-shell form-page"><div className="form-layout"><aside className="form-intro"><p className="eyebrow">Community / Submit resource</p><h1>Share a learning resource.</h1><p className="form-intro__lead">Share your own materials or recommend a free tutorial, presentation, research discussion, or guide that helps members learn about AI agents and prepare for work in the field.</p><div className="form-notice"><strong>Your identity stays private.</strong>If approved, the community resource list will show the resource’s author or publisher, not the submitter.</div></aside><ResourceSubmissionForm /></div></div></main>
}
