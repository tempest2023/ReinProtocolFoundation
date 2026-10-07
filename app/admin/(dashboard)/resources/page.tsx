import { getAdminI18n } from '@/lib/admin/i18n-server'
import { AdminAgentReviewControl } from '@/components/admin-agent-review-control'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'

export const maxDuration = 120

export default async function ResourceReviewPage() {
  const { t, label, locale, attempts } = await getAdminI18n()
  const { service } = await requireAdmin()
  const [{ data: submissions }, { data: jobs }] = await Promise.all([
    service.from('resource_submissions').select('*').order('created_at', { ascending: false }).limit(100),
    service.from('agent_jobs').select('*').eq('job_type', 'resource_submission').order('created_at', { ascending: false }).limit(100),
  ])
  const jobByRecord = new Map((jobs ?? []).map((job) => [job.record_id, job]))

  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Publishing')}</p><h1>{t('Review')}</h1><p>{t('Evaluate public learning-resource submissions before they enter Learn.')}</p></div></header>
      <aside className="admin-note" style={{ marginBottom: '1rem' }}>{t('Open every URL yourself. The Agent classifies the submitted description but does not inspect the external content.')}</aside>
      {submissions?.length ? (
        <div className="admin-record-list">
          {submissions.map((submission) => {
            const job = jobByRecord.get(submission.id)
            const canStartAgent = Boolean(job && ['pending', 'retry', 'failed'].includes(job.status) && ['pending', 'in_review'].includes(submission.status))
            return (
              <details className="admin-record" name="resource-submissions" key={submission.id}>
                <summary>
                  <span className="admin-record__title"><strong>{submission.title}</strong><small>{submission.author_publisher}</small></span>
                  <span className="admin-record__meta">{label(submission.format)} · {submission.language}</span>
                  <span className="status-badge">{label(submission.status)}</span>
                  <small className="admin-record__meta">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(submission.created_at))}</small>
                </summary>
                <div className="admin-record__body">
                  <section className="admin-record__section">
                    <h2>{t('Submission')}</h2>
                    <p><a href={submission.public_url} target="_blank" rel="noreferrer">{t('Open URL for review ↗')}</a></p>
                    <p>{submission.description}</p>
                    <p><strong>{t('Author or publisher:')}</strong> {submission.author_publisher}</p>
                    <p><small>{t('Private submitter:')} {submission.contact_email}</small></p>
                  </section>
                  <section className="admin-record__section">
                    <h2>{t('Agent review')}</h2>
                    {submission.agent_output ? <details className="admin-disclosure"><summary>{t('Inspect structured output')}</summary><pre className="audit-json">{JSON.stringify(submission.agent_output, null, 2)}</pre></details> : <p>{t('Ready for administrator-approved Agent review.')}</p>}
                    {job ? <><p><span className="status-badge">{t('Job')} {label(job.status)}</span> · {attempts(job.attempts)}</p>{job.last_error ? <p className="admin-action-feedback admin-action-feedback--error">{job.last_error}</p> : null}{canStartAgent ? <AdminAgentReviewControl jobId={job.id} jobStatus={job.status} reviewKind="resource" /> : null}</> : <p>{t('No Agent job is attached.')}</p>}
                  </section>
                  <section className="admin-record__section">
                    <h2>{t('Decision')}</h2>
                    <AdminForm actionId="review_resource_submission" successMessage={t('Review recorded and submitter notified.')}>
                      <input type="hidden" name="id" value={submission.id} />
                      <label>{t('Outcome')}<select name="outcome" defaultValue={submission.status === 'pending' || submission.status === 'in_review' ? 'approved' : submission.status}><option value="approved">{t('Approve to Learn draft')}</option><option value="changes_requested">{t('Request changes')}</option><option value="rejected">{t('Reject')}</option></select></label>
                      <label>{t('Review notes')}<textarea name="review_notes" defaultValue={submission.review_notes ?? ''} /></label>
                      <AdminSubmitButton pendingLabel={t('Recording review…')}>{t('Record decision and email submitter')}</AdminSubmitButton>
                    </AdminForm>
                    {submission.created_resource_id ? <p>{t('Learn draft:')} <code>{submission.created_resource_id}</code></p> : null}
                  </section>
                </div>
              </details>
            )
          })}
        </div>
      ) : <div className="admin-empty"><strong>{t('No submissions to review')}</strong><span>{t('New public resource submissions will appear here.')}</span></div>}
    </main>
  )
}
