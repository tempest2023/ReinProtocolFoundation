'use client'

import Link from 'next/link'
import errorSixthStreet from '@/src/assets/scenes/system-error-sixth-street-distilled.webp'
import { Arrow } from '@/components/icons'
import { SystemPage } from '@/components/system-page'
import '../src/index.css'
import '../src/App.css'

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Application error — Rein Protocol Foundation</title>
        <SystemPage
          variant="error"
          eyebrow="System interruption"
          title={<>The site couldn’t<br />be loaded.</>}
          description="The interruption is temporary. Try again, or return to the home page."
          artwork={errorSixthStreet}
          artworkCaption="Los Angeles / Sixth Street Viaduct / Steve Lyon · CC BY-SA 2.0 · altered"
          artworkHref="https://commons.wikimedia.org/wiki/File:Sixth_Street_Viaduct_Los_Angeles_River_(9066252968).jpg"
          live="assertive"
        >
          <div className="system-page__actions">
            <button className="system-page__action system-page__action--primary" type="button" onClick={retry}>
              Try again <Arrow />
            </button>
            <Link href="/" className="system-page__action system-page__action--quiet">Return home</Link>
          </div>
        </SystemPage>
      </body>
    </html>
  )
}
