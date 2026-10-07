import { getAdminI18n } from '@/lib/admin/i18n-server'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { agentModelOptions, agentReasoningEffortOptions, resolveAgentConfiguration } from '@/lib/agent/options'

const settings = [
  ['scheduling_url','Scheduling URL','https://…'],
  ['github_repository_url','GitHub repository','https://github.com/…'],
  ['github_event_url','Event proposal','https://github.com/…'],
  ['github_campus_url','Campus volunteer','https://github.com/…'],
  ['github_technical_url','Technical contribution','https://github.com/…'],
  ['email_identity','Monitored contact email','contact@example.org'],
] as const

export default async function SettingsPage() {
  const { t } = await getAdminI18n()
  const { service } = await requireAdmin()
  const { data } = await service.from('site_settings').select('*')
  const values = new Map((data ?? []).map((item) => [item.setting_key,item.setting_value]))
  const agentConfiguration = resolveAgentConfiguration(Object.fromEntries(values))
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('System')}</p><h1>{t('Settings')}</h1><p>{t('Configure service destinations and Agent review defaults.')}</p></div></header>
      <section className="admin-settings-section" aria-labelledby="operational-settings-heading">
        <header><p className="eyebrow">{t('Operations')}</p><h2 id="operational-settings-heading">{t('Destinations')}</h2></header>
        <div className="admin-settings-list">
          {settings.map(([key,label,placeholder]) => <AdminForm className="admin-form admin-setting-row" actionId="save_setting" successMessage={t('{setting} saved.', { setting: t(label) })} key={key}><input type="hidden" name="setting_key" value={key} /><label><span>{t(label)}</span><input type={key === 'email_identity' ? 'email' : undefined} name="setting_value" defaultValue={values.get(key) ?? ''} placeholder={placeholder} required /></label><AdminSubmitButton pendingLabel={t('Saving…')}>{t('Save')}</AdminSubmitButton></AdminForm>)}
        </div>
      </section>
      <section className="admin-settings-section" aria-labelledby="agent-settings-heading">
        <header><p className="eyebrow">OpenAI</p><h2 id="agent-settings-heading">{t('Agent review')}</h2><p>{t('The selected model and reasoning effort apply to application and resource reviews.')}</p></header>
        <AdminForm className="admin-form admin-agent-settings" actionId="save_agent_settings" successMessage={t('Agent review settings saved.')}>
          <label>
            <span>{t('Model')}</span>
            <select name="openai_model" defaultValue={agentConfiguration.model} required>
              {agentModelOptions.map((option) => <option value={option.value} key={option.value}>{t(option.label)} — {t(option.description)}</option>)}
            </select>
          </label>
          <label>
            <span>{t('Reasoning effort')}</span>
            <select name="openai_reasoning_effort" defaultValue={agentConfiguration.reasoningEffort} required>
              {agentReasoningEffortOptions.map((option) => <option value={option.value} key={option.value}>{t(option.label)}</option>)}
            </select>
            <small>{t('Higher effort can improve difficult reviews but increases latency and token use.')}</small>
          </label>
          <AdminSubmitButton pendingLabel={t('Saving…')}>{t('Save Agent settings')}</AdminSubmitButton>
        </AdminForm>
      </section>
    </main>
  )
}
