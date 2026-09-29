import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/image', () => ({
  default: ({ src, alt, fill: _fill, placeholder: _placeholder, fetchPriority: _fetchPriority, ...props }: {
    src: string | { src: string }
    alt: string
    fill?: boolean
    placeholder?: string
    fetchPriority?: string
  }) => <img src={typeof src === 'string' ? src : src.src} alt={alt} {...props} />,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/missing-page',
}))

import ErrorPage from '@/app/error'
import { ErrorStatePreviewClient } from '@/app/dev/system-states/error/preview-client'
import { LoadingPage } from '@/components/loading-page'
import NotFound from '@/app/not-found'

describe('public system pages', () => {
  it('presents an independent San Francisco loading artwork as an indeterminate status', () => {
    const { container } = render(<LoadingPage />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { name: 'Bringing the next page into view.' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading page')
    expect(screen.getByText(/San Francisco \/ Ferry Building/)).toBeInTheDocument()
    expect(container.querySelector('.system-page__visual img')).toHaveAttribute('src', expect.stringContaining('system-loading-ferry-distilled'))
    expect(container.querySelector('.system-page__visual img')).toHaveAttribute('alt', '')
  })

  it('uses a dedicated Los Angeles composition for a recoverable 404', () => {
    const { container } = render(<NotFound />)

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mission' })).toHaveAttribute('href', '/mission')
    expect(screen.getByRole('heading', { name: 'We couldn’t find that page.' })).toBeInTheDocument()
    expect(screen.getByText(/Los Angeles \/ Bradbury Building/)).toBeInTheDocument()
    expect(container.querySelector('.system-page__visual img')).toHaveAttribute('src', expect.stringContaining('system-not-found-bradbury-distilled'))
    expect(screen.getByRole('link', { name: /Return home/ })).toHaveAttribute('href', '/')
  })

  it('retries runtime errors through the current Next.js recovery API', () => {
    const retry = vi.fn()
    const { container } = render(<ErrorPage error={new Error('temporary')} retry={retry} />)

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { name: 'This page couldn’t be loaded.' })).toBeInTheDocument()
    expect(screen.getByText(/Los Angeles \/ Sixth Street Viaduct/)).toBeInTheDocument()
    expect(container.querySelector('.system-page__visual img')).toHaveAttribute('src', expect.stringContaining('system-error-sixth-street-distilled'))
    expect(screen.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/')
  })

  it('renders the development error preview without throwing an exception', () => {
    expect(() => render(<ErrorStatePreviewClient />)).not.toThrow()
    expect(screen.getByRole('heading', { name: 'This page couldn’t be loaded.' })).toBeInTheDocument()
  })
})
