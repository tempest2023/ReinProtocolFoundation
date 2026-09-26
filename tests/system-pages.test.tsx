import { render, screen } from '@testing-library/react'
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

import { ErrorStatePreviewClient } from '@/app/dev/system-states/error/preview-client'

describe('public system pages', () => {
  it('renders the development error preview without throwing an exception', () => {
    expect(() => render(<ErrorStatePreviewClient />)).not.toThrow()
    expect(screen.getByRole('heading', { name: 'This page couldn’t be loaded.' })).toBeInTheDocument()
  })
})
