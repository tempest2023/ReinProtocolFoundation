import { readFileSync } from 'node:fs'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pathname: vi.fn(() => '/admin/gather'),
  runAdminFormAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: mocks.pathname }))
vi.mock('@/app/admin/actions', () => ({ runAdminFormAction: mocks.runAdminFormAction }))

import { AdminNavigation } from '@/components/admin-navigation'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'

describe('administration presentation', () => {
  it('uses concise navigation labels and marks the current module', () => {
    render(<AdminNavigation />)

    const navigation = screen.getByRole('navigation', { name: 'Administration' })
    for (const label of ['Overview', 'Identities', 'Participants', 'Applications', 'Contributors', 'People', 'Learn', 'Gather', 'Review', 'Guide', 'Settings', 'Audit']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Gather' })).toHaveAttribute('aria-current', 'page')
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Resource Review' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Meeting Guide' })).not.toBeInTheDocument()
  })

  it('keeps direct Rein identity authorization inside the authenticated admin surface', () => {
    const identities = readFileSync('app/admin/(dashboard)/identities/page.tsx', 'utf8')
    const actions = readFileSync('app/admin/actions.ts', 'utf8')

    expect(identities).toContain('Direct registration without email verification')
    expect(identities).toContain('actionId="set_contact_roles"')
    expect(identities).toContain("service.from('rein_platform_links')")
    expect(actions).toContain("service.rpc('admin_set_contact_roles'")
    expect(actions).toContain('p_actor_id: user.id')
  })

  it('keeps the admin shell responsive while dynamic sections stream', () => {
    const loading = readFileSync('app/admin/(dashboard)/loading.tsx', 'utf8')
    const layout = readFileSync('app/admin/(dashboard)/layout.tsx', 'utf8')
    const auth = readFileSync('lib/admin/auth.ts', 'utf8')

    expect(loading).toContain('aria-busy="true"')
    expect(loading).toContain('admin-route-loading')
    expect(layout).toContain('<AdminNavigation />')
    expect(layout).toContain('className="admin-content"')
    expect(auth).toContain('cache(async function requireAdmin()')
  })

  it('keeps creation secondary to content and removes implementation-state empty copy', () => {
    const people = readFileSync('app/admin/(dashboard)/people/page.tsx', 'utf8')
    const learn = readFileSync('app/admin/(dashboard)/learn/page.tsx', 'utf8')
    const gather = readFileSync('app/admin/(dashboard)/gather/page.tsx', 'utf8')
    const pages = `${people}\n${learn}\n${gather}`

    expect(people).toContain('<details className="admin-create-panel">')
    expect(learn).toContain('<details className="admin-create-panel">')
    expect(gather).toContain('<details className="admin-create-panel">')
    expect(pages).not.toMatch(/public page will show|not open yet|check back soon|what is intentionally absent/i)
    expect(learn).toContain('Material type')
    expect(learn).toContain('English, 中文, Spanish')
  })

  it('uses compact record disclosure for review queues instead of forms inside wide tables', () => {
    const applications = readFileSync('app/admin/(dashboard)/applications/page.tsx', 'utf8')
    const resources = readFileSync('app/admin/(dashboard)/resources/page.tsx', 'utf8')

    expect(applications).toContain('className="admin-record"')
    expect(resources).toContain('className="admin-record"')
    expect(applications).not.toContain('className="admin-table"')
    expect(resources).not.toContain('className="admin-table"')
  })

  it('reports an action failure inside the form and moves focus to the feedback', async () => {
    mocks.runAdminFormAction.mockResolvedValue({ status: 'error', message: 'We could not complete this action. Review the fields and try again.' })
    render(<AdminForm actionId="save_setting"><AdminSubmitButton>Save changes</AdminSubmitButton></AdminForm>)

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const feedback = await screen.findByRole('alert')
    expect(feedback).toHaveTextContent('We could not complete this action. Review the fields and try again.')
    expect(feedback).toHaveFocus()
  })

  it('can reset an authorization form from refreshed server data without losing feedback', async () => {
    mocks.runAdminFormAction.mockResolvedValue({ status: 'success', message: '' })
    const { rerender } = render(
      <AdminForm actionId="save_setting" resetKey="active" successMessage="Authorization updated.">
        <label>Role<input name="role" defaultValue="Director" /></label>
        <AdminSubmitButton>Save authorization</AdminSubmitButton>
      </AdminForm>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Role' }), { target: { value: 'Changed locally' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save authorization' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Authorization updated.')
    rerender(
      <AdminForm actionId="save_setting" resetKey="inactive" successMessage="Authorization updated.">
        <label>Role<input name="role" defaultValue="Former Director" /></label>
        <AdminSubmitButton>Save authorization</AdminSubmitButton>
      </AdminForm>,
    )
    expect(screen.getByRole('textbox', { name: 'Role' })).toHaveValue('Former Director')
    expect(screen.getByRole('status')).toHaveTextContent('Authorization updated.')
  })
})
