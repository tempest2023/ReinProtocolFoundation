'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

const groups = [
  {
    label: 'Community',
    links: [
      ['/admin', 'Overview'],
      ['/admin/contacts', 'Contacts'],
      ['/admin/participants', 'Participants'],
      ['/admin/applications', 'Applications'],
      ['/admin/contributors', 'Contributors'],
    ],
  },
  {
    label: 'Publishing',
    links: [
      ['/admin/people', 'People'],
      ['/admin/learn', 'Learn'],
      ['/admin/gather', 'Gather'],
      ['/admin/resources', 'Review'],
    ],
  },
  {
    label: 'System',
    links: [
      ['/admin/guide/contributor-conversation', 'Guide'],
      ['/admin/settings', 'Settings'],
      ['/admin/audit-log', 'Audit'],
    ],
  },
] as const

function isActivePath(pathname: string, href: string) {
  return href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminNavigation() {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
    const navBox = nav.getBoundingClientRect()
    const activeBox = active.getBoundingClientRect()
    nav.scrollTo({ left: nav.scrollLeft + activeBox.left - navBox.left - (navBox.width - activeBox.width) / 2 })
  }, [pathname])

  return (
    <nav className="admin-nav" aria-label="Administration" ref={navRef}>
      {groups.map((group) => (
        <div className="admin-nav__group" key={group.label}>
          <p className="admin-nav__label">{group.label}</p>
          {group.links.map(([href, label]) => {
            const active = isActivePath(pathname, href)
            return <Link href={href} key={href} aria-current={active ? 'page' : undefined}>{label}</Link>
          })}
        </div>
      ))}
    </nav>
  )
}
