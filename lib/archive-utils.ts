/**
 * Utilities for checking if entities can be safely archived
 *
 * An entity can be archived if it's not used in any schedule for the current active quarter.
 * Schedules store snapshots, so archived entities won't affect historical schedule display.
 */

import { sql } from "./db"
import type { GenerationStats } from "./snapshot-utils"

export type ArchiveEntityType = "teacher" | "grade" | "subject"

export interface ArchiveStatusResult {
  entityId: string
  canArchive: boolean
  reason?: string
}

/**
 * Check if entities of a given type are used in current quarter schedules
 * Returns a map of entity ID -> whether it can be archived
 */
export async function checkArchiveStatus(
  entityType: ArchiveEntityType,
  entityIds: string[]
): Promise<ArchiveStatusResult[]> {
  if (entityIds.length === 0) {
    return []
  }

  // Get the active quarter
  const activeQuarters = await sql`
    SELECT id FROM quarters
    WHERE is_active = true AND deleted_at IS NULL
    LIMIT 1
  `

  if (activeQuarters.length === 0) {
    // No active quarter - all entities can be archived
    return entityIds.map((id) => ({ entityId: id, canArchive: true }))
  }

  const activeQuarter = activeQuarters[0]

  // Get all schedule generations for the active quarter (excluding deleted)
  const schedules = await sql`
    SELECT id, stats FROM schedule_generations
    WHERE quarter_id = ${activeQuarter.id} AND deleted_at IS NULL
  `

  if (schedules.length === 0) {
    // No schedules for active quarter - all entities can be archived
    return entityIds.map((id) => ({ entityId: id, canArchive: true }))
  }

  // Collect all entity IDs used in schedules
  const usedEntityIds = new Set<string>()

  for (const schedule of schedules) {
    const stats = schedule.stats as GenerationStats | null
    if (!stats) continue

    switch (entityType) {
      case "teacher":
        // Check teachers_snapshot for direct teacher IDs
        if (stats.teachers_snapshot) {
          for (const teacher of stats.teachers_snapshot) {
            usedEntityIds.add(teacher.id)
          }
        }
        // Also check classes_snapshot for teacher_id
        if (stats.classes_snapshot) {
          for (const cls of stats.classes_snapshot) {
            if (cls.teacher_id) {
              usedEntityIds.add(cls.teacher_id)
            }
          }
        }
        break

      case "grade":
        // Check grades_snapshot for direct grade IDs
        if (stats.grades_snapshot) {
          for (const grade of stats.grades_snapshot) {
            usedEntityIds.add(grade.id)
          }
        }
        // Also check classes_snapshot for grade_ids
        if (stats.classes_snapshot) {
          for (const cls of stats.classes_snapshot) {
            if (cls.grade_ids) {
              for (const gradeId of cls.grade_ids) {
                usedEntityIds.add(gradeId)
              }
            }
            // Legacy: check grades array
            if (cls.grades) {
              for (const grade of cls.grades) {
                usedEntityIds.add(grade.id)
              }
            }
          }
        }
        break

      case "subject":
        // Check classes_snapshot for subject_id
        if (stats.classes_snapshot) {
          for (const cls of stats.classes_snapshot) {
            if (cls.subject_id) {
              usedEntityIds.add(cls.subject_id)
            }
          }
        }
        break
    }
  }

  // Return results
  return entityIds.map((id) => {
    const isUsed = usedEntityIds.has(id)
    return {
      entityId: id,
      canArchive: !isUsed,
      reason: isUsed
        ? `Used in ${schedules.length} schedule${schedules.length !== 1 ? "s" : ""} for the current quarter`
        : undefined,
    }
  })
}

/**
 * Get archived entities of a given type
 */
export async function getArchivedEntities(
  entityType: ArchiveEntityType | "quarter" | "timetable_template"
): Promise<Array<{ id: string; name: string; deleted_at: string }>> {
  let data: Array<{ id: string; name?: string; display_name?: string; deleted_at: string }>

  switch (entityType) {
    case "teacher":
      data = await sql`
        SELECT id, name, deleted_at FROM teachers
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `
      break
    case "grade":
      data = await sql`
        SELECT id, display_name, deleted_at FROM grades
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `
      break
    case "subject":
      data = await sql`
        SELECT id, name, deleted_at FROM subjects
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `
      break
    case "quarter":
      data = await sql`
        SELECT id, name, deleted_at FROM quarters
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `
      break
    case "timetable_template":
      data = await sql`
        SELECT id, name, deleted_at FROM timetable_templates
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `
      break
    default:
      return []
  }

  return data.map((item) => ({
    id: item.id,
    name: (entityType === "grade" ? item.display_name : item.name) || "",
    deleted_at: item.deleted_at,
  }))
}
