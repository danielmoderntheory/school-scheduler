/**
 * Utilities for checking if entities can be safely archived
 *
 * An entity can be archived if it's not used in any schedule for the current active quarter.
 * Schedules store snapshots, so archived entities won't affect historical schedule display.
 */

import { supabase } from "./supabase-admin"
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
  const { data: activeQuarter, error: quarterError } = await supabase
    .from("quarters")
    .select("id")
    .eq("is_active", true)
    .is("deleted_at", null)
    .single()

  if (quarterError || !activeQuarter) {
    // No active quarter - all entities can be archived
    return entityIds.map((id) => ({ entityId: id, canArchive: true }))
  }

  // Get all schedule generations for the active quarter
  const { data: schedules, error: schedulesError } = await supabase
    .from("schedule_generations")
    .select("id, stats")
    .eq("quarter_id", activeQuarter.id)

  if (schedulesError) {
    throw new Error(`Failed to fetch schedules: ${schedulesError.message}`)
  }

  if (!schedules || schedules.length === 0) {
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
  const tableName =
    entityType === "timetable_template" ? "timetable_templates" : `${entityType}s`
  const nameField =
    entityType === "grade" ? "display_name" : "name"

  const { data, error } = await supabase
    .from(tableName)
    .select(`id, ${nameField}, deleted_at`)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch archived ${entityType}s: ${error.message}`)
  }

  return (data || []).map((item) => ({
    id: item.id,
    name: item[nameField as keyof typeof item] as string,
    deleted_at: item.deleted_at,
  }))
}
