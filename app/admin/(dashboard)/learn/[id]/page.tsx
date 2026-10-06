import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { RESOURCE_FORMATS } from '@/lib/community/constants'

export default async function EditResourcePage({params}:{params:Promise<{id:string}>}) {
  const { t } = await getAdminI18n()
  const { id } = await params
  const { service } = await requireAdmin()
  const { data: resource } = await service.from('resources').select('*').eq('id',id).maybeSingle()
  if (!resource) notFound()
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Learn / Edit')}</p><h1>{resource.title}</h1></div><Link className="admin-button admin-button--quiet" href={`/admin/learn/preview/${id}`}>{t('Preview draft')}</Link></header>
      <section className="admin-panel">
        <AdminForm className="admin-form admin-form--grid" actionId="update_resource" successMessage={t('Resource saved as a draft.')}>
          <input type="hidden" name="id" value={resource.id}/>
          <label>{t('Title')}<input name="title" defaultValue={resource.title} required/></label>
          <label>{t('Material type')}<select name="resource_type" defaultValue={resource.resource_type}>{RESOURCE_FORMATS.map((format)=><option key={format} value={format}>{t(format)}</option>)}</select></label>
          <label className="admin-field--wide">{t('Summary')}<textarea name="summary" defaultValue={resource.summary} required/></label>
          <label className="admin-field--wide">{t('Public URL')}<input type="url" name="public_url" defaultValue={resource.public_url} required/></label>
          <label>{t('Language')}<input name="language" defaultValue={resource.language} placeholder={t('e.g. English, 中文, Spanish')} required/></label>
          <label>{t('Difficulty')}<input name="difficulty" defaultValue={resource.difficulty??''}/></label>
          <label>{t('Topics')}<input name="topics" defaultValue={(resource.topics??[]).join(', ')}/></label>
          <label>{t('Author or publisher')}<input name="author_publisher" defaultValue={resource.author_publisher??''}/></label>
          <label className="admin-field--wide">{t('Access notes')}<textarea name="access_notes" defaultValue={resource.access_notes??''}/></label>
          <AdminSubmitButton pendingLabel={t('Saving resource…')}>{t('Save resource draft')}</AdminSubmitButton>
        </AdminForm>
      </section>
    </main>
  )
}
