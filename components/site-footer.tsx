import Link from 'next/link'
import { FoundationMark } from '@/components/icons'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main page-shell">
        <Link href="/" className="wordmark wordmark--footer">
          <FoundationMark variant="footer" />
          <span>Rein Protocol<small>Foundation</small></span>
        </Link>
        <p className="footer-thesis">Web3 first. Agent operated. Human accountable.</p>
        <nav aria-label="Footer navigation">
          <Link href="/">Home</Link>
          <Link href="/mission">Mission</Link>
          <Link href="/programs">Programs</Link>
          <Link href="/governance">Governance</Link>
          <Link href="/community">Community</Link>
          <Link href="/giving">Giving</Link>
        </nav>
      </div>
      <div className="footer-legal page-shell">
        <p>Advancing beneficial AI, public knowledge and accountable Agent infrastructure.</p>
        <p><Link href="/privacy">Privacy</Link> · <Link href="/community/code-of-conduct">Code of Conduct</Link></p>
        <p>© 2026 Rein Protocol Foundation</p>
      </div>
      <details className="image-credits page-shell">
        <summary>Image sources and notes</summary>
        <p>Atmospheric artworks are source-preserving paper-collage interpretations, not documentary photographs.</p>
        <ul>
          <li><a href="https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge,_SF.jpg" target="_blank" rel="noreferrer">Golden Gate Bridge — Bernard Gagnon</a></li>
          <li><a href="https://commons.wikimedia.org/wiki/File:Mission_Santa_Clara.jpg" target="_blank" rel="noreferrer">Mission Santa Clara — JaGa</a></li>
          <li><a href="https://commons.wikimedia.org/wiki/File:Hoover_Tower_west_face.JPG" target="_blank" rel="noreferrer">Hoover Tower — © BrokenSphere, CC BY-SA</a></li>
          <li><a href="https://commons.wikimedia.org/wiki/File:Palo_Alto_Baylands_January_2013_001.jpg" target="_blank" rel="noreferrer">Palo Alto Baylands — King of Hearts, CC BY-SA 3.0</a></li>
          <li><a href="https://commons.wikimedia.org/wiki/File:Griffith_Observatory.jpg" target="_blank" rel="noreferrer">Griffith Observatory — Serouj, public domain</a></li>
          <li>Community convergence study — original source-derived illustration</li>
        </ul>
      </details>
    </footer>
  )
}
