import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string }) => <img src={src} alt={alt} {...props} />,
}))

vi.mock('@/lib/community/actions', () => ({
  registerParticipant: vi.fn(async () => ({ status: 'success' })),
  submitContributorApplication: vi.fn(async () => ({ status: 'success' })),
  submitResource: vi.fn(async () => ({ status: 'success' })),
}))

import { ContributorForm } from '@/components/forms/contributor-form'
import { ParticipantForm } from '@/components/forms/participant-form'
import { ResourceSubmissionForm } from '@/components/forms/resource-form'
import { FormStatus } from '@/components/forms/form-controls'
import { registerParticipant } from '@/lib/community/actions'

describe('public community forms', () => {
  it('includes the optional profile links and omits a time-commitment question', () => {
    render(<ContributorForm />)
    expect(screen.getByLabelText('Personal website')).toBeInTheDocument()
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument()
    expect(screen.getByLabelText('Google Scholar')).toBeInTheDocument()
    expect(screen.getByLabelText('LinkedIn')).toBeInTheDocument()
    expect(screen.queryByText(/monthly|hours per month/i)).not.toBeInTheDocument()
  })

  it('keeps public forms available without pre-launch availability copy', () => {
    render(<ContributorForm />)
    expect(screen.queryByText(/not open|check back soon/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Personal website')).toBeEnabled()
    expect(screen.getByLabelText('GitHub')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit Contributor application' })).toBeEnabled()
  })

  it('shows operational submission failures in a dismissible dialog', async () => {
    render(<FormStatus state={{ status: 'error', presentation: 'dialog', message: 'Please try again in a few minutes. Your information was not submitted.' }} />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByRole('heading', { name: 'We couldn’t submit the form.' })).toBeInTheDocument()
    expect(dialog.querySelector('.submission-dialog__art')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close and try again' }))
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  })

  it.each([
    { dialogKicker: 'Registration complete', dialogTitle: 'You’re registered.' },
    { dialogKicker: 'Application received', dialogTitle: 'Application submitted.' },
    { dialogKicker: 'Resource received', dialogTitle: 'Resource submitted.' },
  ])('shows $dialogKicker in the shared success dialog', async ({ dialogKicker, dialogTitle }) => {
    render(<FormStatus state={{ status: 'success', presentation: 'dialog', dialogKicker, dialogTitle, message: 'Your submission was received.' }} />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('open')
    expect(dialog).toHaveAttribute('data-kind', 'success')
    expect(screen.getByText(dialogKicker)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: dialogTitle })).toBeInTheDocument()
    expect(dialog.querySelector('.submission-dialog__art img')).toHaveAttribute('src', '/images/submission-sf-distillation-zine.png')
    expect(dialog.querySelector('.submission-dialog__art img')).toHaveAttribute('alt', '')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  })

  it('switches between U.S. state and international country without requesting an address', () => {
    const { container } = render(<ParticipantForm />)
    expect(screen.queryByText(/does not create legal membership/i)).not.toBeInTheDocument()
    expect(screen.queryByText('An approved pseudonym is welcome.')).not.toBeInTheDocument()
    expect(screen.queryByText('Do not enter a street address.')).not.toBeInTheDocument()
    expect(container.querySelector('.location-header .field-label')).toHaveTextContent('Region')
    expect(container.querySelector('.location-header .field-label')).not.toHaveTextContent('*')
    const internationalSwitch = screen.getByRole('switch', { name: 'Outside the United States' })
    expect(internationalSwitch).toHaveAttribute('aria-checked', 'false')
    expect(container.querySelector('input[name="location_scope"]')).toHaveValue('united_states')
    expect(screen.getByRole('combobox', { name: /^State/ })).toBeInTheDocument()
    fireEvent.click(internationalSwitch)
    expect(internationalSwitch).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelector('input[name="location_scope"]')).toHaveValue('international')
    expect(screen.getByRole('combobox', { name: /^Country/ })).toBeInTheDocument()
    expect(container.querySelector('[name="street_address"], [name="address"]')).toBeNull()
  })

  it('preserves participant entries when submission fails', async () => {
    vi.mocked(registerParticipant).mockResolvedValueOnce({
      status: 'error',
      presentation: 'dialog',
      message: 'Please try again in a few minutes. Your information was not submitted.',
    })

    const { container } = render(<ParticipantForm />)
    fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'person@example.org' } })
    fireEvent.change(screen.getByRole('combobox', { name: /^Field or industry/ }), { target: { value: 'Education' } })
    fireEvent.change(screen.getByRole('combobox', { name: /^State/ }), { target: { value: 'CA' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^City/ }), { target: { value: 'Oakland' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /community and activity messages/ }))

    fireEvent.submit(container.querySelector('form')!)
    await screen.findByRole('dialog')

    expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveValue('person@example.org')
    expect(screen.getByRole('combobox', { name: /^Field or industry/ })).toHaveValue('Education')
    expect(screen.getByRole('combobox', { name: /^State/ })).toHaveValue('CA')
    expect(screen.getByRole('textbox', { name: /^City/ })).toHaveValue('Oakland')
    expect(screen.getByRole('checkbox', { name: /community and activity messages/ })).toBeChecked()
  })

  it('clears participant entries after submission succeeds', async () => {
    vi.mocked(registerParticipant).mockResolvedValueOnce({
      status: 'success',
      presentation: 'dialog',
      dialogKicker: 'Registration complete',
      dialogTitle: 'You’re registered.',
      message: 'We will use your information only for community communication and administration.',
    })

    const { container } = render(<ParticipantForm />)
    fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'person@example.org' } })
    fireEvent.change(screen.getByRole('combobox', { name: /^Field or industry/ }), { target: { value: 'Education' } })
    fireEvent.change(screen.getByRole('combobox', { name: /^State/ }), { target: { value: 'CA' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^City/ }), { target: { value: 'Oakland' } })

    fireEvent.submit(container.querySelector('form')!)
    await screen.findByRole('dialog')

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveValue('')
      expect(screen.getByRole('combobox', { name: /^Field or industry/ })).toHaveValue('')
      expect(screen.getByRole('combobox', { name: /^State/ })).toHaveValue('')
      expect(screen.getByRole('textbox', { name: /^City/ })).toHaveValue('')
    })
  })

  it('accepts public resource URLs without offering file uploads', () => {
    const { container } = render(<ResourceSubmissionForm />)
    expect(screen.getByLabelText(/Public URL/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Factual author or publisher/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Material type/ })).toHaveDisplayValue('Select a material type')
    expect(screen.getByRole('textbox', { name: /^Language/ })).toHaveAttribute('placeholder', 'e.g. English, 中文, Spanish')
    expect(screen.getByRole('textbox', { name: /^Description/ })).toHaveAttribute('maxlength', '1000')
    expect(screen.getByRole('textbox', { name: /^Description/ })).toHaveAttribute('placeholder', expect.stringMatching(/what members can learn about AI agents/))
    expect(screen.queryByRole('textbox', { name: /How is this relevant/ })).not.toBeInTheDocument()
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })
})
