'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Arrow, FoundationMark } from '@/components/icons'

const links = [
  ['/', 'Home'],
  ['/mission', 'Mission'],
  ['/programs', 'Programs'],
  ['/governance', 'Governance'],
  ['/community', 'Community'],
] as const

const communityLinks = [
  ['/community', 'Overview'],
  ['/community#program', 'Program'],
  ['/community#people', 'People'],
  ['/community#register', 'Connect'],
  ['/community#contribute', 'Contribute'],
] as const

export function SiteHeader() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [communityHash, setCommunityHash] = useState('')
  const communityNavigationRef = useRef<HTMLElement>(null)
  const inCommunity = pathname === '/community' || pathname.startsWith('/community/')
  const activeCommunityHref = pathname.startsWith('/community/contribute')
    ? '/community#contribute'
    : pathname.startsWith('/community/gather/')
      ? '/community#program'
      : pathname === '/community'
        ? communityHash === '#program' || communityHash === '#learn' || communityHash === '#gather'
          ? '/community#program'
          : communityHash === '#people'
            ? '/community#people'
            : communityHash === '#register'
              ? '/community#register'
              : communityHash === '#contribute'
                ? '/community#contribute'
                : '/community'
        : null

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const syncCommunityHash = () => setCommunityHash(window.location.hash)
    const syncCommunityLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const link = event.target.closest<HTMLAnchorElement>('a[href]')
      if (!link) return
      const destination = new URL(link.href)
      if (destination.pathname === '/community') setCommunityHash(destination.hash)
    }

    syncCommunityHash()
    window.addEventListener('hashchange', syncCommunityHash)
    window.addEventListener('popstate', syncCommunityHash)
    document.addEventListener('click', syncCommunityLink)
    return () => {
      window.removeEventListener('hashchange', syncCommunityHash)
      window.removeEventListener('popstate', syncCommunityHash)
      document.removeEventListener('click', syncCommunityLink)
    }
  }, [pathname])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  useEffect(() => {
    if (pathname === '/community' && communityHash) {
      const targetId = communityHash === '#learn' || communityHash === '#gather'
        ? 'program'
        : communityHash.slice(1)
      window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: 'start' }))
    }

    const navigation = communityNavigationRef.current
    const activeLink = navigation?.querySelector<HTMLElement>('a.is-active')
    if (!navigation || !activeLink) return
    window.requestAnimationFrame(() => {
      const navigationBounds = navigation.getBoundingClientRect()
      const linkBounds = activeLink.getBoundingClientRect()
      if (linkBounds.left < navigationBounds.left || linkBounds.right > navigationBounds.right) {
        navigation.scrollTo({
          left: navigation.scrollLeft + linkBounds.left - navigationBounds.left - (navigationBounds.width - linkBounds.width) / 2,
        })
      }
    })
  }, [activeCommunityHref, communityHash, pathname])

  return (
    <header className="site-header">
      <div className="nav-shell">
        <Link href="/" className="wordmark">
          <FoundationMark />
          <span>Rein Protocol<small>Foundation</small></span>
        </Link>
        <button
          className="menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
        </button>
        <nav id="primary-navigation" className={`primary-navigation ${menuOpen ? 'is-open' : ''}`} aria-label="Primary navigation">
          {links.map(([href, label]) => {
            const current = href === '/' ? pathname === '/' : pathname.startsWith(href)
            const exact = pathname === href
            return <Link key={href} href={href} className={current ? 'is-active' : undefined} aria-current={exact ? 'page' : current ? 'location' : undefined}>{label}</Link>
          })}
          <Link href="/giving" className={`nav-action ${pathname === '/giving' ? 'is-active' : ''}`} aria-current={pathname === '/giving' ? 'page' : undefined}>
            Giving <Arrow />
          </Link>
        </nav>
      </div>
      {inCommunity ? (
        <nav ref={communityNavigationRef} className="community-navigation" aria-label="Community navigation">
          <div className="page-shell community-navigation__inner">
            {communityLinks.map(([href, label]) => {
              const current = activeCommunityHref === href
              return <Link key={href} href={href} className={current ? 'is-active' : undefined} aria-current={current ? (href.includes('#') ? 'location' : 'page') : undefined}>{label}</Link>
            })}
          </div>
        </nav>
      ) : null}
    </header>
  )
}
