import { getAdminI18n } from '@/lib/admin/i18n-server'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/admin/auth'

export default async function ResourcePreview({params}:{params:Promise<{id:string}>}) {
  const { t, label } = await getAdminI18n()
  const {id}=await params; const {service}=await requireAdmin(); const {data:resource}=await service.from('resources').select('*').eq('id',id).maybeSingle(); if(!resource) notFound()
  return <main className="admin-main"><header className="admin-heading"><div><p className="eyebrow">{t('Private preview ·')} {label(resource.publication_status)}</p><h1>{resource.title}</h1><p>{resource.summary}</p></div></header><article className="admin-panel"><p className="resource-card__meta">{label(resource.resource_type)} · {resource.language}{resource.difficulty?` · ${resource.difficulty}`:''}</p><p>{t('Topics:')} {(resource.topics??[]).join(', ')||t('None')}</p><p>{t('Author/publisher:')} {resource.author_publisher||t('Not recorded')}</p><p>{resource.access_notes}</p><a className="admin-button" href={resource.public_url} target="_blank" rel="noreferrer">{t('Open external resource ↗')}</a></article></main>
}
