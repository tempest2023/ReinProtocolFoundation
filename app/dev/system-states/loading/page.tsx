import { notFound } from 'next/navigation'
import { LoadingPage } from '@/components/loading-page'

export default function LoadingStatePreview() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return <LoadingPage />
}
