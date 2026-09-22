export function FoundationMark({ variant = 'header' }: { variant?: 'header' | 'footer' }) {
  return (
    <img
      className={`foundation-mark foundation-mark--${variant}`}
      src={`/brand/rein-mark-${variant}.png`}
      width={42}
      height={42}
      alt=""
      aria-hidden="true"
    />
  )
}

export function Arrow() {
  return (
    <svg className="arrow" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2 9h13M10 4l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
