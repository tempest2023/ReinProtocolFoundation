import Image, { type StaticImageData } from 'next/image'
import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/site-header'

type SystemPageProps = {
  variant: 'loading' | 'not-found' | 'error'
  eyebrow: string
  title: ReactNode
  description?: string
  artwork: StaticImageData
  artworkCaption: string
  artworkHref: string
  children?: ReactNode
  busy?: boolean
  live?: 'polite' | 'assertive'
  /** Renders the page-level header and skip link. Turn off when a layout already provides them. */
  chrome?: boolean
}

export function SystemPage({
  variant,
  eyebrow,
  title,
  description,
  artwork,
  artworkCaption,
  artworkHref,
  children,
  busy = false,
  live,
  chrome = true,
}: SystemPageProps) {
  const titleId = `system-page-${variant}-title`

  return (
    <>
      {chrome ? <><a className="skip-link" href="#main-content">Skip to main content</a><SiteHeader /></> : null}
      <main
        id="main-content"
        className={`system-page system-page--${variant}`}
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        aria-live={live}
      >
        <figure className="system-page__visual">
          <Image
            src={artwork}
            alt=""
            fill
            sizes="100vw"
            placeholder="blur"
            loading="eager"
            fetchPriority="high"
          />
          <figcaption>
            <a href={artworkHref} target="_blank" rel="noreferrer">
              {artworkCaption}
            </a>
          </figcaption>
        </figure>

        <div className="system-page__frame page-shell">
          <section className="system-page__content">
            <p className="eyebrow">{eyebrow}</p>
            <h1 id={titleId}>{title}</h1>
            {description ? <p className="system-page__description">{description}</p> : null}
            {children}
          </section>
        </div>
      </main>
    </>
  )
}
