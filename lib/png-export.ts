export async function downloadSchedulesAsPng({ viewMode }: { viewMode: string }) {
  const [{ toPng }, { default: JSZip }] = await Promise.all([
    import("html-to-image"),
    import("jszip"),
  ])

  const container = document.querySelector(".print-grid")
  if (!container) throw new Error("No schedule grid found")

  const cards = container.querySelectorAll<HTMLElement>("[data-card-name]")
  if (cards.length === 0) throw new Error("No schedule cards found")

  const zip = new JSZip()

  for (const card of Array.from(cards)) {
    const rawName = card.getAttribute("data-card-name") || "Unknown"

    // Temporarily override grid-stretch and table flex for compact rows
    const tables = card.querySelectorAll<HTMLElement>("table")
    const prevAlignSelf = card.style.alignSelf
    const prevHeight = card.style.height
    const prevBoxShadow = card.style.boxShadow
    card.style.alignSelf = "start"
    card.style.height = "auto"
    card.style.boxShadow = "none"

    const prevTableFlex: string[] = []
    tables.forEach(t => { prevTableFlex.push(t.style.flex); t.style.flex = "none" })

    // Force reflow + wait one frame so layout settles before capture
    void card.offsetHeight
    await new Promise(resolve => requestAnimationFrame(resolve))

    const dataUrl = await toPng(card, {
      backgroundColor: "white",
      pixelRatio: 2,
      filter: (node: HTMLElement) => !node.classList?.contains("no-print"),
    })

    // Restore
    card.style.alignSelf = prevAlignSelf
    card.style.height = prevHeight
    card.style.boxShadow = prevBoxShadow
    tables.forEach((t, i) => { t.style.flex = prevTableFlex[i] })

    const res = await fetch(dataUrl)
    const blob = await res.blob()

    const prefix =
      viewMode === "teacher"
        ? "Teacher"
        : viewMode === "timetable"
          ? "Timetable"
          : "Grade"
    const safeName = rawName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/_+$/, "")
    zip.file(`${prefix}_${safeName}.png`, blob)
  }

  const zipBlob = await zip.generateAsync({ type: "blob" })
  const date = new Date().toISOString().slice(0, 10)

  const a = document.createElement("a")
  a.href = URL.createObjectURL(zipBlob)
  a.download = `Schedules_${viewMode}_${date}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}
