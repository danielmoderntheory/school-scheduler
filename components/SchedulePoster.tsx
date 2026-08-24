"use client"

import type { PosterCell, PosterData, PosterRow } from "@/lib/poster-utils"

// =============================================================================
// POSTER — the printable blue schedule card (recreation of the Canva design).
//
// Renders at its true export size (2560x1664 CSS px) so html-to-image can
// capture it at pixelRatio 1 with no fractional layout. It is never part of the
// normal page: the export mounts it off-screen, captures it, and unmounts.
//
// Everything scales off ONE factor so a 10-row card and a 14-row card both fill
// the canvas and stay legible: natural row heights are summed, compared to the
// space available, and heights/type sizes multiplied by the ratio.
// =============================================================================

export const POSTER_WIDTH = 2560
export const POSTER_HEIGHT = 1664

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI"]

/** Sampled from the reference cards. */
const BLUE = "#6DA0BD"
const INK = "#000000"

const TITLE_BAND = 196 // top strip the heading sits in
const SIDE_MARGIN = 200
const RIGHT_MARGIN = 169
const BOTTOM_MARGIN = 64
const TIME_COL = 281 // width of the left bell-time column

// Natural (un-scaled) row heights — the proportions of the reference card.
const NATURAL_HEADER = 86
const NATURAL_MERGED = 105
const NATURAL_BLOCK = 130

// Natural type sizes, scaled by the same factor as the rows.
const FONT_DAY = 36
const FONT_TIME = 34
const FONT_MERGED = 52
const FONT_CELL = 46

/** The squiggle artwork itself, served from public/. */
export const POSTER_SQUIGGLE_SRC = "/poster-squiggle.png"

/**
 * The squiggle pattern behind the card.
 *
 * This is the school's own Canva asset (public/poster-squiggle.png), recolored
 * to white-on-transparent so one file covers every placement — exactly how the
 * original was built, with the same shape dropped in three times at different
 * sizes and rotations, each mostly hanging off the canvas so only a corner of
 * it shows. Positions were matched against the reference exports; at 0.44
 * opacity over the blue it lands on #ADCADA, against the original's #ADCBDC.
 */
const SQUIGGLES = [
  { left: -640, top: -320, width: 1150, rotate: 105 }, // upper left
  { left: 2210, top: -330, width: 1250, rotate: 193 }, // upper right, trailing down the edge
  { left: 2080, top: 1120, width: 1150, rotate: 310 }, // lower right
]

function PosterBackdrop() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: BLUE,
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      {SQUIGGLES.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={POSTER_SQUIGGLE_SRC}
          alt=""
          style={{
            position: "absolute",
            left: s.left,
            top: s.top,
            width: s.width,
            transform: `rotate(${s.rotate}deg)`,
            transformOrigin: "50% 50%",
            opacity: 0.44,
          }}
        />
      ))}
    </div>
  )
}

function naturalHeight(row: PosterRow): number {
  return row.kind === "merged" ? NATURAL_MERGED : NATURAL_BLOCK
}

function CellText({ cell, size }: { cell: PosterCell; size: number }) {
  return (
    <div style={{ lineHeight: 1.12 }}>
      <div style={{ fontWeight: 700, fontSize: size, letterSpacing: "0.01em" }}>
        {cell.main.toUpperCase()}
      </div>
      {cell.sub && (
        <div
          style={{
            fontWeight: 600,
            fontSize: Math.round(size * 0.6),
            letterSpacing: "0.03em",
            opacity: 0.62,
            marginTop: Math.round(size * 0.1),
          }}
        >
          {cell.sub.toUpperCase()}
        </div>
      )}
    </div>
  )
}

export function SchedulePoster({ data }: { data: PosterData }) {
  const tableTop = TITLE_BAND
  const tableHeight = POSTER_HEIGHT - TITLE_BAND - BOTTOM_MARGIN
  const tableWidth = POSTER_WIDTH - SIDE_MARGIN - RIGHT_MARGIN

  // Fit the rows to the card: scale heights so the table always fills it, and
  // scale type by the same factor (capped, so a short card doesn't shout).
  const natural =
    NATURAL_HEADER + data.rows.reduce((sum, row) => sum + naturalHeight(row), 0)
  const inner = tableHeight - 8 // the 4px outer border, top and bottom
  const scale = natural > 0 ? inner / natural : 1
  const fontScale = Math.min(scale, 1.05)

  const headerHeight = Math.round(NATURAL_HEADER * scale)
  const px = (n: number) => Math.round(n * fontScale)

  // The heading is one line at any length: shrink to fit the card's width.
  const titleText = data.title.toUpperCase()
  const titleSize = Math.max(
    44,
    Math.min(94, Math.floor((POSTER_WIDTH - 2 * SIDE_MARGIN - 60) / (titleText.length * 0.64)))
  )

  const dayColWidth = `${(100 - (TIME_COL / tableWidth) * 100) / 5}%`

  return (
    <div
      data-poster-name={data.fileName}
      style={{
        position: "relative",
        width: POSTER_WIDTH,
        height: POSTER_HEIGHT,
        overflow: "hidden",
        backgroundColor: BLUE,
        fontFamily: "var(--font-poster), Poppins, 'Segoe UI', Helvetica, Arial, sans-serif",
        color: INK,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <PosterBackdrop />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: SIDE_MARGIN,
          width: POSTER_WIDTH - 2 * SIDE_MARGIN,
          height: TITLE_BAND,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            color: "#FFFFFF",
            fontWeight: 800,
            fontSize: titleSize,
            letterSpacing: "-0.005em",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          {titleText}
        </div>
      </div>

      <table
        style={{
          position: "absolute",
          top: tableTop,
          left: SIDE_MARGIN,
          width: tableWidth,
          height: tableHeight,
          borderCollapse: "collapse",
          border: `4px solid ${INK}`,
          backgroundColor: "#FFFFFF",
          tableLayout: "fixed",
        }}
      >
        <thead>
          <tr style={{ height: headerHeight }}>
            <th style={{ width: TIME_COL, border: `3px solid ${INK}` }} />
            {DAY_LABELS.map(day => (
              <th
                key={day}
                style={{
                  width: dayColWidth,
                  border: `3px solid ${INK}`,
                  fontWeight: 700,
                  fontSize: px(FONT_DAY),
                  letterSpacing: "0.22em",
                  // letter-spacing pads the right of the last glyph; nudge back
                  // so the label reads as centred.
                  textIndent: "0.22em",
                }}
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => {
            const height = Math.round(naturalHeight(row) * scale)
            return (
              <tr key={i} style={{ height }}>
                <td
                  style={{
                    border: `3px solid ${INK}`,
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: px(FONT_TIME),
                    letterSpacing: "0.02em",
                    whiteSpace: "nowrap",
                    padding: "0 10px",
                  }}
                >
                  {row.time}
                </td>
                {row.kind === "merged" ? (
                  <td
                    colSpan={5}
                    style={{
                      border: `3px solid ${INK}`,
                      textAlign: "center",
                      fontWeight: 700,
                      fontSize: px(FONT_MERGED),
                      letterSpacing: "0.01em",
                      padding: "0 24px",
                    }}
                  >
                    {row.label.toUpperCase()}
                  </td>
                ) : (
                  row.cells.map((cell, d) => (
                    <td
                      key={d}
                      style={{
                        border: `3px solid ${INK}`,
                        textAlign: "center",
                        verticalAlign: "middle",
                        padding: `0 ${Math.round(14 * fontScale)}px`,
                      }}
                    >
                      {cell && <CellText cell={cell} size={px(FONT_CELL)} />}
                    </td>
                  ))
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
