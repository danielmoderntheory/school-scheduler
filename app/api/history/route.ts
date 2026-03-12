import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")
  const starredOnly = searchParams.get("starred_only") === "true"
  const mostRecent = searchParams.get("most_recent") === "true"
  const limit = searchParams.get("limit")
  const snapshotVersionOnly = searchParams.get("snapshot_version_only") === "true"
  const summaryOnly = searchParams.get("summary") === "true"
  const showDeleted = searchParams.get("show_deleted") === "true"

  try {
    // Lightweight query for just snapshot versions (used for class locking)
    if (snapshotVersionOnly && quarterId) {
      const data = await sql`
        SELECT generated_at, stats->'snapshotVersion' as snapshot_version
        FROM schedule_generations
        WHERE quarter_id = ${quarterId} AND deleted_at IS NULL
      `

      // Find max snapshot version
      let maxVersion = 0
      for (const row of data) {
        const version = row.snapshot_version || new Date(row.generated_at).getTime()
        if (version > maxVersion) maxVersion = version
      }

      return NextResponse.json({ maxSnapshotVersion: maxVersion })
    }

    // Summary mode - lightweight list without heavy JSONB columns
    // Includes lightweight stats extracted from stats column
    if (summaryOnly) {
      const parsedLimit = limit ? parseInt(limit) : null
      const before = searchParams.get("before") // For pagination - get items before this timestamp

      let data
      // With pagination (before timestamp)
      if (before && parsedLimit) {
        if (quarterId) {
          data = showDeleted
            ? await sql`
              SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                     sg.notes, sg.is_starred, sg.deleted_at,
                     (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                     (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                     jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                     jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                     q.id as quarter_id_ref, q.name as quarter_name
              FROM schedule_generations sg
              LEFT JOIN quarters q ON sg.quarter_id = q.id
              WHERE sg.quarter_id = ${quarterId} AND sg.generated_at < ${before}
              ORDER BY sg.generated_at DESC
              LIMIT ${parsedLimit}
            `
            : await sql`
              SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                     sg.notes, sg.is_starred, sg.deleted_at,
                     (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                     (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                     jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                     jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                     q.id as quarter_id_ref, q.name as quarter_name
              FROM schedule_generations sg
              LEFT JOIN quarters q ON sg.quarter_id = q.id
              WHERE sg.quarter_id = ${quarterId} AND sg.generated_at < ${before} AND sg.deleted_at IS NULL
              ORDER BY sg.generated_at DESC
              LIMIT ${parsedLimit}
            `
        } else {
          data = showDeleted
            ? await sql`
              SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                     sg.notes, sg.is_starred, sg.deleted_at,
                     (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                     (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                     jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                     jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                     q.id as quarter_id_ref, q.name as quarter_name
              FROM schedule_generations sg
              LEFT JOIN quarters q ON sg.quarter_id = q.id
              WHERE sg.generated_at < ${before}
              ORDER BY sg.generated_at DESC
              LIMIT ${parsedLimit}
            `
            : await sql`
              SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                     sg.notes, sg.is_starred, sg.deleted_at,
                     (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                     (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                     jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                     jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                     q.id as quarter_id_ref, q.name as quarter_name
              FROM schedule_generations sg
              LEFT JOIN quarters q ON sg.quarter_id = q.id
              WHERE sg.generated_at < ${before} AND sg.deleted_at IS NULL
              ORDER BY sg.generated_at DESC
              LIMIT ${parsedLimit}
            `
        }
      } else if (quarterId && parsedLimit) {
        data = showDeleted
          ? await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            WHERE sg.quarter_id = ${quarterId}
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
            LIMIT ${parsedLimit}
          `
          : await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            WHERE sg.quarter_id = ${quarterId} AND sg.deleted_at IS NULL
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
            LIMIT ${parsedLimit}
          `
      } else if (quarterId) {
        data = showDeleted
          ? await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            WHERE sg.quarter_id = ${quarterId}
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
          `
          : await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            WHERE sg.quarter_id = ${quarterId} AND sg.deleted_at IS NULL
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
          `
      } else if (parsedLimit) {
        data = showDeleted
          ? await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
            LIMIT ${parsedLimit}
          `
          : await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            WHERE sg.deleted_at IS NULL
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
            LIMIT ${parsedLimit}
          `
      } else {
        data = showDeleted
          ? await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
          `
          : await sql`
            SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                   sg.notes, sg.is_starred, sg.deleted_at,
                   (sg.stats->>'studyHallsPlaced')::int as study_halls_placed,
                   (sg.stats->>'backToBackIssues')::int as back_to_back_issues,
                   jsonb_array_length(sg.stats->'classes_snapshot') as classes_count,
                   jsonb_array_length(sg.stats->'teachers_snapshot') as teachers_count,
                   q.id as quarter_id_ref, q.name as quarter_name
            FROM schedule_generations sg
            LEFT JOIN quarters q ON sg.quarter_id = q.id
            WHERE sg.deleted_at IS NULL
            ORDER BY sg.is_starred DESC, sg.generated_at DESC
          `
      }

      const result = data.map((row: {
        id: string
        quarter_id: string
        generated_at: string
        selected_option: number
        notes: string | null
        is_starred: boolean
        deleted_at: string | null
        study_halls_placed: number | null
        back_to_back_issues: number | null
        classes_count: number | null
        teachers_count: number | null
        quarter_id_ref: string
        quarter_name: string
      }) => ({
        id: row.id,
        quarter_id: row.quarter_id,
        generated_at: row.generated_at,
        selected_option: row.selected_option,
        notes: row.notes,
        is_starred: row.is_starred,
        deleted_at: row.deleted_at,
        studyHallsPlaced: row.study_halls_placed ?? 0,
        backToBackIssues: row.back_to_back_issues ?? 0,
        classesCount: row.classes_count ?? 0,
        teachersCount: row.teachers_count ?? 0,
        options: null, // Not loaded in summary mode
        quarter: row.quarter_id_ref ? { id: row.quarter_id_ref, name: row.quarter_name } : null,
      }))

      return NextResponse.json(result)
    }

    // Build conditions and order
    const conditions: string[] = []
    if (quarterId) conditions.push("quarter_id")
    if (starredOnly) conditions.push("starred")

    const orderBy = mostRecent
      ? "sg.generated_at DESC"
      : "sg.is_starred DESC, sg.generated_at DESC"

    let data
    const parsedLimit = limit ? parseInt(limit) : null

    // Query based on conditions (always exclude deleted)
    if (quarterId && starredOnly) {
      if (parsedLimit) {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.quarter_id = ${quarterId} AND sg.is_starred = true AND sg.deleted_at IS NULL
          ORDER BY sg.generated_at DESC
          LIMIT ${parsedLimit}
        `
      } else {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.quarter_id = ${quarterId} AND sg.is_starred = true AND sg.deleted_at IS NULL
          ORDER BY sg.generated_at DESC
        `
      }
    } else if (quarterId) {
      if (parsedLimit) {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.quarter_id = ${quarterId} AND sg.deleted_at IS NULL
          ORDER BY sg.is_starred DESC, sg.generated_at DESC
          LIMIT ${parsedLimit}
        `
      } else {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.quarter_id = ${quarterId} AND sg.deleted_at IS NULL
          ORDER BY sg.is_starred DESC, sg.generated_at DESC
        `
      }
    } else if (starredOnly) {
      if (parsedLimit) {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.is_starred = true AND sg.deleted_at IS NULL
          ORDER BY sg.generated_at DESC
          LIMIT ${parsedLimit}
        `
      } else {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.is_starred = true AND sg.deleted_at IS NULL
          ORDER BY sg.generated_at DESC
        `
      }
    } else {
      if (parsedLimit) {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.deleted_at IS NULL
          ORDER BY sg.is_starred DESC, sg.generated_at DESC
          LIMIT ${parsedLimit}
        `
      } else {
        data = await sql`
          SELECT sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
                 sg.notes, sg.is_starred, sg.options,
                 q.id as quarter_id_ref, q.name as quarter_name
          FROM schedule_generations sg
          LEFT JOIN quarters q ON sg.quarter_id = q.id
          WHERE sg.deleted_at IS NULL
          ORDER BY sg.is_starred DESC, sg.generated_at DESC
        `
      }
    }

    // Transform to match expected format
    const result = data.map((row: {
      id: string
      quarter_id: string
      generated_at: string
      selected_option: number
      notes: string | null
      is_starred: boolean
      options: unknown
      quarter_id_ref: string
      quarter_name: string
    }) => ({
      id: row.id,
      quarter_id: row.quarter_id,
      generated_at: row.generated_at,
      selected_option: row.selected_option,
      notes: row.notes,
      is_starred: row.is_starred,
      options: row.options,
      quarter: row.quarter_id_ref ? { id: row.quarter_id_ref, name: row.quarter_name } : null,
    }))

    return NextResponse.json(result)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  try {
    const stats = {
      backToBackIssues: body.options[0]?.backToBackIssues || 0,
      studyHallsPlaced: body.options[0]?.studyHallsPlaced || 0,
      quarter_name: body.quarter_name || null,
      classes_snapshot: body.classes_snapshot || [],
      rules_snapshot: body.rules_snapshot || [],
      teachers_snapshot: body.teachers_snapshot || [],
      grades_snapshot: body.grades_snapshot || [],
      allSolutions: body.allSolutions || [],
    }

    const [data] = await sql`
      INSERT INTO schedule_generations (quarter_id, options, selected_option, notes, stats)
      VALUES (
        ${body.quarter_id},
        ${JSON.stringify(body.options)},
        ${body.selected_option || 1},
        ${body.notes || null},
        ${JSON.stringify(stats)}
      )
      RETURNING *
    `

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
