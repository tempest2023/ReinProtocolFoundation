'use client'

import { useEffect, useId, useState } from 'react'
import { AdminForm } from '@/components/admin-form'
import { useAdminI18n } from '@/components/admin-i18n'
import { AdminSubmitButton } from '@/components/admin-submit-button'

type PermissionStatus = 'active' | 'inactive'

export function AdminIdentityAuthorizationForm({
  contactId,
  contributorStatus,
  directorStatus: initialDirectorStatus,
  directorDisplayName,
  directorSlug,
  directorRole,
  directorPublicationStatus,
  resetKey,
}: {
  contactId: string
  contributorStatus: PermissionStatus
  directorStatus: PermissionStatus
  directorDisplayName: string
  directorSlug: string
  directorRole: string
  directorPublicationStatus?: string
  resetKey: string
}) {
  const { t, label } = useAdminI18n()
  const contributorSelectId = useId()
  const directorSelectId = useId()
  const descriptionId = useId()
  const [directorStatus, setDirectorStatus] = useState<PermissionStatus>(initialDirectorStatus)
  const grantsDirectorPermissions = directorStatus === 'active'

  useEffect(() => {
    setDirectorStatus(initialDirectorStatus)
  }, [initialDirectorStatus, resetKey])

  return (
    <AdminForm
      actionId="set_contact_roles"
      resetKey={resetKey}
      successMessage={t('Rein identity permissions updated.')}
    >
      <input type="hidden" name="contact_id" value={contactId} />
      <div className="admin-form__field">
        <label htmlFor={contributorSelectId}>{t('Contributor permissions')}</label>
        <select id={contributorSelectId} name="contributor_status" defaultValue={contributorStatus}>
          <option value="inactive">{t('Do not grant Contributor permissions')}</option>
          <option value="active">{t('Grant Contributor permissions')}</option>
        </select>
      </div>
      <div className="admin-form__field">
        <label htmlFor={directorSelectId}>{t('Director permissions')}</label>
        <select
          id={directorSelectId}
          name="director_status"
          value={directorStatus}
          aria-describedby={descriptionId}
          onChange={(event) => setDirectorStatus(event.currentTarget.value as PermissionStatus)}
        >
          <option value="inactive">{t('Do not grant Director permissions')}</option>
          <option value="active">{t('Grant Director permissions')}</option>
        </select>
        <small id={descriptionId}>{t('Director permissions allow this person to perform Director-only actions through the Rein Agent.')}</small>
      </div>
      <fieldset hidden={!grantsDirectorPermissions} disabled={!grantsDirectorPermissions}>
        <legend>{t('Director profile details')}</legend>
        <p>{t('Required when granting Director permissions. A draft profile is created if none exists; publication remains separate.')}</p>
        <label>{t('Director display name')}<input name="director_display_name" defaultValue={directorDisplayName} required={grantsDirectorPermissions} /></label>
        <label>{t('Director profile slug')}<input name="director_slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={directorSlug} required={grantsDirectorPermissions} /></label>
        <label>{t('Director role')}<input name="director_role" defaultValue={directorRole} required={grantsDirectorPermissions} /></label>
        {directorPublicationStatus ? <p><small>{t('Profile publication: {status}. Director permissions are managed separately.', { status: label(directorPublicationStatus) })}</small></p> : null}
      </fieldset>
      <AdminSubmitButton pendingLabel={t('Saving permissions…')}>{t('Save permissions')}</AdminSubmitButton>
    </AdminForm>
  )
}
