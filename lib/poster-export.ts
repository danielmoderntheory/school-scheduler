// =============================================================================
// POSTER EXPORT — render + capture + zip
//
// Unlike lib/png-export.ts (which photographs the schedule cards already on the
// page), posters are not part of any view: each one is mounted off-screen at its
// true export size, captured, and unmounted. That keeps the poster styling
// completely independent of the on-screen grids.
// =============================================================================

import { createElement } from "react"
import type { PosterData } from "./poster-utils"

/** Floor for the auto-fit shrink — below this a card stops being readable. */
const MIN_TEXT_SCALE = 0.55

/** Waits for layout and paint to settle before capturing. */
function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

/**
 * Warms the browser cache for the backdrop artwork. Without this the first
 * poster can rasterize before the squiggle has decoded and come out plain blue,
 * while every later one is fine — the kind of bug that only shows up in the
 * first file of the zip.
 */
function preloadImage(src: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve() // a missing backdrop must not block the export
    img.src = src
  })
}

export async function downloadPostersAsPng({
  posters,
  zipName,
}: {
  posters: PosterData[]
  zipName: string
}) {
  if (posters.length === 0) throw new Error("Nothing to export")

  const [
    { toPng },
    { default: JSZip },
    { createRoot },
    { SchedulePoster, POSTER_SQUIGGLE_SRC },
  ] = await Promise.all([
      import("html-to-image"),
      import("jszip"),
      import("react-dom/client"),
      import("@/components/SchedulePoster"),
    ])

  // Webfonts and the backdrop must both be resolved before the first capture,
  // or the earliest posters rasterize in the fallback face / without artwork.
  await Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    preloadImage(POSTER_SQUIGGLE_SRC),
  ])

  const stage = document.createElement("div")
  stage.style.cssText =
    "position:fixed;top:0;left:-100000px;width:2560px;pointer-events:none;z-index:-1;"
  document.body.appendChild(stage)
  const root = createRoot(stage)

  const zip = new JSZip()
  try {
    for (const poster of posters) {
      // Fit pass: a cell whose text wraps to more lines than the layout
      // budgeted grows its row, and a row height is a MINIMUM in CSS — so the
      // table can push past the bottom of the card and clip the last rows.
      // Render, measure, and shrink the type until the table fits. Converges
      // fast because smaller text also wraps less; the floor stops a
      // pathological card from becoming unreadable rather than looping.
      let textScale = 1
      let node: HTMLElement | null = null
      for (let attempt = 0; attempt < 4; attempt++) {
        root.render(createElement(SchedulePoster, { data: poster, textScale }))
        await nextFrame()
        await nextFrame()

        node = stage.firstElementChild as HTMLElement | null
        if (!node) break

        const table = node.querySelector<HTMLElement>("[data-poster-table]")
        if (!table) break
        // A table's CSS height is a MINIMUM — an overgrown table reports the
        // grown size for both offsetHeight and scrollHeight, so the budget has
        // to come from the component rather than from the element.
        const budget = Number(table.dataset.posterTableBudget)
        const actual = table.offsetHeight
        if (!budget || actual <= budget + 1 || textScale <= MIN_TEXT_SCALE) break

        textScale = Math.max(MIN_TEXT_SCALE, textScale * (budget / actual) * 0.98)
      }
      if (!node) continue

      const dataUrl = await toPng(node, {
        backgroundColor: "#6DA0BD",
        pixelRatio: 1,
        width: node.offsetWidth,
        height: node.offsetHeight,
      })
      const blob = await (await fetch(dataUrl)).blob()
      zip.file(`${poster.fileName}.png`, blob)
    }
  } finally {
    root.unmount()
    stage.remove()
  }

  const zipBlob = await zip.generateAsync({ type: "blob" })
  const date = new Date().toISOString().slice(0, 10)

  const a = document.createElement("a")
  a.href = URL.createObjectURL(zipBlob)
  a.download = `${zipName}_${date}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}
