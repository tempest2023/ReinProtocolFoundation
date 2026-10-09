import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminI18nProvider } from '@/components/admin-i18n'
import { AdminIdentityAuthorizationForm } from '@/components/admin-identity-authorization-form'

vi.mock('@/app/admin/actions', () => ({ runAdminFormAction: vi.fn() }))

function renderForm(directorStatus: 'active' | 'inactive' = 'inactive', language: 'en' | 'zh' = 'en') {
  return render(
    <AdminI18nProvider language={language}>
      <AdminIdentityAuthorizationForm
        contactId="00000000-0000-4000-8000-000000000001"
        contributorStatus="inactive"
        directorStatus={directorStatus}
        directorDisplayName="Example Person"
        directorSlug="example-person"
        directorRole="Director"
        resetKey={`identity:${directorStatus}`}
      />
    </AdminI18nProvider>,
  )
}

describe('admin Rein identity permissions', () => {
  it('reveals Director profile fields only when Director permissions are granted', () => {
    renderForm()

    const permissions = screen.getByRole('combobox', { name: 'Director permissions' })
    expect(screen.getByLabelText('Director display name')).not.toBeVisible()
    expect(permissions).toHaveAccessibleDescription('Director permissions allow this person to perform Director-only actions through the Rein Agent.')

    fireEvent.change(permissions, { target: { value: 'active' } })

    expect(screen.getByLabelText('Director display name')).toBeVisible()
    expect(screen.getByLabelText('Director profile slug')).toBeVisible()
    expect(screen.getByLabelText('Director role')).toBeVisible()
  })

  it('uses permission language instead of activation language in Chinese', () => {
    renderForm('inactive', 'zh')

    const directorPermissions = screen.getByRole('combobox', { name: 'Director 权限' })
    expect(screen.getByRole('option', { name: '不授予 Director 权限' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '授予 Director 权限' })).toBeInTheDocument()
    expect(screen.queryByText('未启用')).not.toBeInTheDocument()

    fireEvent.change(directorPermissions, { target: { value: 'active' } })
    expect(screen.getByLabelText('董事显示名称')).toBeVisible()
  })
})
