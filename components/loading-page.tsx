import loadingFerry from '@/src/assets/scenes/system-loading-ferry-distilled.webp'
import { SystemPage } from '@/components/system-page'

export function LoadingPage({ chrome = true }: { chrome?: boolean }) {
  return (
    <SystemPage
      variant="loading"
      eyebrow="Loading"
      title={<>Bringing the next page<br />into view.</>}
      description="This should only take a moment."
      artwork={loadingFerry}
      artworkCaption="San Francisco / Ferry Building / DXR · CC BY-SA 4.0 · altered"
      artworkHref="https://commons.wikimedia.org/wiki/File:Ferry_building,_San_Francisco,_South_view_20110804_1.jpg"
      chrome={chrome}
      busy
      live="polite"
    >
      <div className="system-page__loading-status" role="status">
        <span className="system-page__progress" aria-hidden="true"><span /></span>
        <span>Loading page</span>
      </div>
    </SystemPage>
  )
}
