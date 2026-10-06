import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { RESOURCE_FORMATS } from '@/lib/community/constants'

export default async function LearnAdminPage() {
  const { t, label } = await getAdminI18n()
  const { service } = await requireAdmin()
  const { data: resources } = await service.from('resources').select('*').order('sort_order').order('created_at',{ ascending:false })
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Publishing')}</p><h1>{t('Learn')}</h1><p>{t('Draft, verify, order, and publish free learning resources.')}</p></div><Link className="admin-button admin-button--quiet" href="/community/learn" target="_blank">{t('View public page ↗')}</Link></header>
      <div className="admin-stack">
        <details className="admin-create-panel">
          <summary><strong>{t('Create resource')}</strong><span>{t('Start a new draft')}</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="create_resource" successMessage={t('Resource draft created.')}>
            <label>{t('Title')}<input name="title" required /></label>
            <label>{t('Slug')}<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="resource-name" required /></label>
            <label className="admin-field--wide">{t('Summary')}<textarea name="summary" required /></label>
            <label className="admin-field--wide">{t('Public URL')}<input type="url" name="public_url" placeholder="https://…" required /></label>
            <label>{t('Material type')}<select name="resource_type">{RESOURCE_FORMATS.map((format) => <option key={format} value={format}>{t(format)}</option>)}</select></label>
            <label>{t('Language')}<input name="language" placeholder={t('e.g. English, 中文, Spanish')} required /></label>
            <label>{t('Difficulty')}<input name="difficulty" placeholder={t('e.g. Introductory')} /></label>
            <label>{t('Topics')}<input name="topics" placeholder={t('Agents, alignment, evaluation')} /></label>
            <label>{t('Author or publisher')}<input name="author_publisher" /></label>
            <label>{t('Access notes')}<textarea name="access_notes" /></label>
            <AdminSubmitButton pendingLabel={t('Creating draft…')}>{t('Create resource draft')}</AdminSubmitButton>
          </AdminForm>
        </details>
        <aside className="admin-note">{t('Before publishing, open the URL and verify relevance, attribution, copyright context, and free public access.')}</aside>
        {resources?.length ? (
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t('Resource')}</th><th>{t('Source')}</th><th>{t('Status')}</th><th>{t('Publication')}</th></tr></thead><tbody>{resources.map((resource) => <tr key={resource.id}>
            <td><strong>{resource.title}</strong><br /><small>{label(resource.resource_type)} · {resource.language}</small><br/><Link href={`/admin/learn/${resource.id}`}>{t('Edit')}</Link> · <Link href={`/admin/learn/preview/${resource.id}`}>{t('Preview')}</Link></td>
            <td><a href={resource.public_url} target="_blank" rel="noreferrer">{t('Open URL ↗')}</a><br /><small>{resource.author_publisher}</small></td>
            <td><span className="status-badge">{label(resource.publication_status)}</span></td>
            <td><AdminForm className="admin-form admin-row-form" actionId="set_resource_publication" successMessage={t('Publication settings saved.')}><input type="hidden" name="id" value={resource.id} /><label>{t('Status')}<select name="status" defaultValue={resource.publication_status}><option value="draft">{t('Draft')}</option><option value="published">{t('Published')}</option><option value="archived">{t('Archived')}</option></select></label><label>{t('Order')}<input type="number" name="sort_order" defaultValue={resource.sort_order} /></label><label className="admin-check"><input type="checkbox" name="featured" defaultChecked={resource.featured} /> {t('Featured')}</label><label className="admin-check"><input type="checkbox" name="access_verified" defaultChecked={Boolean(resource.access_verified_at)} /> {t('Free public access verified')}</label><AdminSubmitButton pendingLabel={t('Saving…')}>{t('Save publication')}</AdminSubmitButton></AdminForm></td>
          </tr>)}</tbody></table></div>
        ) : <div className="admin-empty"><strong>{t('No learning resources yet')}</strong><span>{t('Create a draft or approve a public submission.')}</span></div>}
      </div>
    </main>
  )
}
