# Rein Protocol Foundation identity

The approved identity is concept 08, **Architectural R**: a supporting column, open arch and orange beam. The pillar expresses support and foundation; the open bowl retains the recognizable R. Keep the selected artwork’s proportions, colors and details intact.

## Assets by context

| Asset | Intended use |
| --- | --- |
| `rein-mark.png` | Original 1254 × 1254 transparent master; organization brand artwork and large-format digital use |
| `rein-mark.svg` | Self-contained SVG wrapper of the same raster master; **not a traced vector** |
| `rein-mark-header.png` | Tightly framed 160 × 160 transparent export for the warm-paper website header |
| `rein-mark-footer.png` | 192 × 192 warm-paper tile for contrast on the dark website footer |
| `rein-avatar-paper.png` | 1024 × 1024 warm-paper organization avatar, with generous surrounding space |
| `rein-avatar-white.png` | 1024 × 1024 white organization avatar for directories and profile uploads |

The header and footer use decorative images beside the accessible organization name. Do not put the dark transparent master directly on a dark background; use the paper tile or avatar there.

## Browser and device assets

The favicon package supplied by the user is preserved byte-for-byte:

- `app/icon.svg`: packaged light/dark SVG favicon (contains embedded raster images).
- `public/favicon.svg`: compatibility URL for the same packaged SVG.
- `app/favicon.ico`: multi-size ICO for browser compatibility.
- `app/icon1.png` and `public/favicon-96x96.png`: 96px PNG icon, with Next.js generating its metadata link.
- `app/apple-icon.png` and `public/apple-touch-icon.png`: supplied 180px Apple touch icon.
- `public/web-app-manifest-192x192.png` and `public/web-app-manifest-512x512.png`: supplied launcher images.

`public/site.webmanifest` replaces the generator’s placeholder names and broken `/favicon.ico/` paths with the Foundation name, root-relative asset paths and warm-paper theme. Launcher icons are declared `any`; no unverified maskable-safe-zone claim is made. Adding a manifest does not imply offline support.

## Source and reproduction

The transparent master is the user-selected image-generation concept `08-architectural.png`. Website variants are lossless PNG exports using Sharp: trim only surrounding transparency for the header, retain the original silhouette, resize with aspect ratio preserved, and use #f5ead3 or #ffffff where an opaque background is required. No new artwork was generated or redrawn in this asset integration.

Use the PNG master for future exports. Avoid upscaling it for print; a separately reviewed vector reconstruction would be required for large print applications.
