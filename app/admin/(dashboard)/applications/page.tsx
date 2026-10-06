import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { AdminAgentReviewControl } from '@/components/admin-agent-review-control'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'

export const maxDuration = 120

export default async function ApplicationsPage() {
  const { t, locale, label, attempts } = await getAdminI18n()
  const { service } = await requireAdmin()
  const [{ data: applications }, { data: jobs }] = await Promise.all([
    service.from('contributor_applications').select('*').order('created_at', { ascending: false }).limit(100),
    service.from('agent_jobs').select('*').eq('job_type', 'contributor_application').order('created_at', { ascending: false }).limit(100),
  ])
  const jobByRecord = new Map((jobs ?? []).map((job) => [job.record_id, job]))

  return (
    <main className="admin-main">
      <header className="admin-heading">
        <div><p className="eyebrow">{t('Community')}</p><h1>{t('Applications')}</h1><p>{t('Review verified Contributor applications and coordinate 1v1 conversations.')}</p></div>
        <Link className="admin-button admin-button--quiet" href="/admin/guide/contributor-conversation">{t('Open meeting guide')}</Link>
      </header>
      {applications?.length ? (
        <div className="admin-record-list">
          {applications.map((application) => {
            const job = jobByRecord.get(application.id)
            const links = [
              [t('Website'), application.personal_website],
              ['GitHub', application.github_url],
              [t('Scholar'), application.scholar_url],
              ['LinkedIn', application.linkedin_url],
            ].filter((item): item is [string, string] => Boolean(item[1]))
            const canStartAgent = Boolean(
              job
              && ['pending', 'retry', 'failed'].includes(job.status)
              && application.email_verified_at
              && ['submitted', 'agent_processing'].includes(application.status),
            )
            const submittedAt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(application.created_at))
            const location = [application.city_region, application.us_state, application.country].filter(Boolean).join(', ')

            return (
              <details className="admin-record" name="applications" key={application.id}>
                <summary>
                  <span className="admin-record__title"><strong>{application.name}</strong><small>{application.email}</small></span>
                  <span className="admin-record__meta">{location || t('Location not supplied')}</span>
                  <span className="status-badge">{label(application.status)}</span>
                  <small className="admin-record__meta">{submittedAt}</small>
                </summary>
                <div className="admin-record__body">
                  <section className="admin-record__section">
                    <h2>{t('Applicant')}</h2>
                    <p><a href={`mailto:${application.email}`}>{application.email}</a><br /><small>{location}</small></p>
                    <p><strong>{t('Industry:')}</strong> {application.industry ? `${application.industry}${application.industry_other ? ` — ${application.industry_other}` : ''}` : t('Not supplied')}</p>
                    <p><strong>{t('Profile preference:')}</strong> {application.profile_willingness ? label(application.profile_willingness) : t('Not supplied')}</p>
                    {links.length ? <p>{links.map(([label, href], index) => <span key={label}><a href={href} target="_blank" rel="noreferrer">{label} ↗</a>{index < links.length - 1 ? ' · ' : ''}</span>)}</p> : null}
                    <h2>{t('Intent')}</h2>
                    <strong>{t('Why participate')}</strong>
                    <ul>{application.participation_reasons.map((item: string) => <li key={item}>{t(item)}</li>)}</ul>
                    {application.participation_reason_other ? <p>{application.participation_reason_other}</p> : null}
                    <strong>{t('Contribution areas')}</strong>
                    <ul>{application.contribution_areas.map((item: string) => <li key={item}>{t(item)}</li>)}</ul>
                    {application.contribution_area_other ? <p>{application.contribution_area_other}</p> : null}
                  </section>
                  <section className="admin-record__section">
                    <h2>{t('Agent review')}</h2>
                    {application.agent_output ? <details className="admin-disclosure"><summary>{t('Inspect structured output')}</summary><pre className="audit-json">{JSON.stringify(application.agent_output, null, 2)}</pre></details> : <p>{application.email_verified_at ? t('Ready for administrator-approved Agent review.') : t('Waiting for email verification.')}</p>}
                    {job ? <><p><span className="status-badge">{t('Job')} {label(job.status)}</span> · {attempts(job.attempts)}</p>{job.last_error ? <p className="admin-action-feedback admin-action-feedback--error">{job.last_error}</p> : null}{canStartAgent ? <AdminAgentReviewControl jobId={job.id} jobStatus={job.status} reviewKind="application" /> : null}</> : <p>{t('No Agent job is attached.')}</p>}
                  </section>
                  <section className="admin-record__section">
                    <h2>{t('Next action')}</h2>
                    {application.status === 'email_pending' ? <AdminForm actionId="resend_contributor_verification" successMessage={t('Verification link sent.')}><input type="hidden" name="id" value={application.id} /><AdminSubmitButton pendingLabel={t('Sending…')}>{t('Send verification link')}</AdminSubmitButton></AdminForm> : null}
                    {application.status === 'auto_rejected' ? <AdminForm actionId="restore_application" successMessage={t('Application restored to human review.')}><input type="hidden" name="id" value={application.id} /><AdminSubmitButton pendingLabel={t('Restoring…')}>{t('Restore to human review')}</AdminSubmitButton></AdminForm> : null}
                    {['reviewing', 'submitted'].includes(application.status) ? <AdminForm actionId="invite_applicant" successMessage={t('1v1 invitation sent.')}><input type="hidden" name="id" value={application.id} /><AdminSubmitButton pendingLabel={t('Sending invitation…')}>{t('Send 1v1 invitation')}</AdminSubmitButton></AdminForm> : null}
                    {application.status !== 'email_pending' ? (
                      <AdminForm actionId="set_application_status" successMessage={t('Application status saved.')}>
                        <input type="hidden" name="id" value={application.id} />
                        <label>{t('Status')}<select name="status" defaultValue={application.status === 'auto_rejected' || application.status === 'agent_processing' || application.status === 'invitation_sent' ? 'reviewing' : application.status}><option value="reviewing">{t('Reviewing')}</option><option value="meeting_scheduled">{t('Meeting scheduled')}</option><option value="conversation_complete">{t('Conversation complete')}</option><option value="closed">{t('Closed')}</option></select></label>
                        <label>{t('Meeting notes')}<textarea name="meeting_notes" defaultValue={application.meeting_notes ?? ''} /></label>
                        <label>{t('Host decision')}<input name="host_decision" defaultValue={application.host_decision ?? ''} /></label>
                        <AdminSubmitButton pendingLabel={t('Saving status…')}>{t('Save application status')}</AdminSubmitButton>
                      </AdminForm>
                    ) : null}
                    {application.status === 'conversation_complete' ? <AdminForm actionId="create_contributor" successMessage={t('Contributor record created.')}><input type="hidden" name="application_id" value={application.id} /><AdminSubmitButton pendingLabel={t('Creating Contributor…')}>{t('Create Contributor')}</AdminSubmitButton></AdminForm> : null}
                  </section>
                </div>
              </details>
            )
          })}
        </div>
      ) : <div className="admin-empty"><strong>{t('No applications yet')}</strong><span>{t('Verified applications will enter this review queue.')}</span></div>}
    </main>
  )
}
