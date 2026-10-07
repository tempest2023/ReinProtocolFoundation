'use client'

import { useAdminI18n } from '@/components/admin-i18n'
import { useActionState } from 'react'
import { startAgentReview, type AgentReviewActionState } from '@/app/admin/actions'

const initialState: AgentReviewActionState = { status: 'idle', message: '' }

type AgentReviewControlProps = {
  jobId: string
  jobStatus: string
  reviewKind: 'application' | 'resource'
}

export function AdminAgentReviewControl({ jobId, jobStatus, reviewKind }: AgentReviewControlProps) {
  const { t } = useAdminI18n()
  const [state, formAction, pending] = useActionState(startAgentReview, initialState)
  const isRetry = jobStatus === 'retry' || jobStatus === 'failed'
  const buttonLabel = reviewKind === 'application'
    ? pending ? 'Running application Agent review…' : isRetry ? 'Retry application Agent review' : 'Start application Agent review'
    : pending ? 'Running resource Agent review…' : isRetry ? 'Retry resource Agent review' : 'Start resource Agent review'

  return (
    <form action={formAction} className="admin-agent-control">
      <input type="hidden" name="id" value={jobId} />
      <p className="admin-agent-control__note">
        {reviewKind === 'application'
          ? t('Sends the approved application fields to OpenAI now. A severe, high-confidence safety result may apply the configured automatic rejection and email.')
          : t('Sends the submitted description to OpenAI now. The Agent does not open the external URL or publish the resource.')}
      </p>
      <button className="admin-button admin-button--quiet" type="submit" disabled={pending}>
        {t(buttonLabel)}
      </button>
      {state.message ? (
        <p
          className={`admin-action-feedback admin-action-feedback--${state.status}`}
          role={state.status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {t(state.message)}
        </p>
      ) : null}
    </form>
  )
}
