/**
 * Migration script to add snapshot data to an old schedule generation
 *
 * This script:
 * 1. Fetches current classes, teachers, grades, rules from production
 * 2. Formats them into the new snapshot structure
 * 3. Updates the old schedule_generations record with the snapshots
 *
 * Usage:
 *   npx tsx scripts/migrate-schedule-snapshot.ts <generation_id>
 *
 * Example:
 *   npx tsx scripts/migrate-schedule-snapshot.ts abc12345-6789-...
 */

import { createClient } from '@supabase/supabase-js'

// Get environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function migrateScheduleSnapshot(generationId: string) {
  console.log(`\nMigrating schedule generation: ${generationId}\n`)

  // 1. Fetch the old generation to get its quarter_id
  console.log('Fetching generation record...')
  const { data: generation, error: genError } = await supabase
    .from('schedule_generations')
    .select('*, quarter:quarters(id, name)')
    .eq('id', generationId)
    .single()

  if (genError || !generation) {
    console.error('Failed to fetch generation:', genError?.message)
    process.exit(1)
  }

  console.log(`  Found generation for quarter: ${generation.quarter?.name}`)
  console.log(`  Current stats:`, generation.stats ? Object.keys(generation.stats) : 'none')

  const quarterId = generation.quarter_id

  // 2. Fetch all required data for snapshots
  console.log('\nFetching production data...')

  // Fetch classes with all relations
  const { data: classes, error: classesError } = await supabase
    .from('classes')
    .select(`
      id,
      days_per_week,
      is_elective,
      grade_ids,
      teacher:teachers(id, name),
      grade:grades(id, name, display_name),
      subject:subjects(id, name),
      restrictions(id, restriction_type, value)
    `)
    .eq('quarter_id', quarterId)

  if (classesError) {
    console.error('Failed to fetch classes:', classesError.message)
    process.exit(1)
  }
  console.log(`  Classes: ${classes?.length || 0}`)

  // Fetch teachers
  const { data: teachers, error: teachersError } = await supabase
    .from('teachers')
    .select('id, name, status, can_supervise_study_hall')
    .order('name')

  if (teachersError) {
    console.error('Failed to fetch teachers:', teachersError.message)
    process.exit(1)
  }
  console.log(`  Teachers: ${teachers?.length || 0}`)

  // Fetch grades
  const { data: grades, error: gradesError } = await supabase
    .from('grades')
    .select('id, name, display_name, sort_order')
    .order('sort_order')

  if (gradesError) {
    console.error('Failed to fetch grades:', gradesError.message)
    process.exit(1)
  }
  console.log(`  Grades: ${grades?.length || 0}`)

  // Fetch rules
  const { data: rules, error: rulesError } = await supabase
    .from('rules')
    .select('id, rule_key, enabled, config')

  if (rulesError) {
    console.error('Failed to fetch rules:', rulesError.message)
    process.exit(1)
  }
  console.log(`  Rules: ${rules?.length || 0}`)

  // 3. Build snapshots in the exact format used by generate page

  // Create a grades lookup for multi-grade classes
  const gradesMap = new Map(grades?.map(g => [g.id, g]) || [])

  const classesSnapshot = (classes || []).map((c: any) => {
    // Get grade_ids - use the array if populated, otherwise fall back to single grade
    const gradeIds = c.grade_ids?.length ? c.grade_ids : (c.grade?.id ? [c.grade.id] : [])

    // Build grades array with full info for display
    const gradesArray = gradeIds.map((gid: string) => {
      const g = gradesMap.get(gid)
      return g ? { id: g.id, name: g.name, display_name: g.display_name } : null
    }).filter(Boolean)

    return {
      teacher_id: c.teacher?.id || null,
      teacher_name: c.teacher?.name || null,
      grade_id: c.grade?.id || null,
      grade_ids: gradeIds,
      grades: gradesArray,
      is_elective: c.is_elective || false,
      subject_id: c.subject?.id || null,
      subject_name: c.subject?.name || null,
      days_per_week: c.days_per_week,
      restrictions: (c.restrictions || []).map((r: any) => ({
        restriction_type: r.restriction_type,
        value: r.value,
      })),
    }
  })

  const rulesSnapshot = (rules || []).map((r: any) => ({
    rule_key: r.rule_key,
    enabled: r.enabled,
    config: r.config || null,
  }))

  const teachersSnapshot = (teachers || []).map((t: any) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    canSuperviseStudyHall: t.can_supervise_study_hall,
  }))

  const gradesSnapshot = (grades || []).map((g: any) => ({
    id: g.id,
    name: g.name,
    display_name: g.display_name,
  }))

  // 4. Merge with existing stats (preserve backToBackIssues, studyHallsPlaced, etc)
  const existingStats = generation.stats || {}
  const newStats = {
    ...existingStats,
    quarter_name: generation.quarter?.name || null,
    classes_snapshot: classesSnapshot,
    rules_snapshot: rulesSnapshot,
    teachers_snapshot: teachersSnapshot,
    grades_snapshot: gradesSnapshot,
  }

  console.log('\nBuilt snapshots:')
  console.log(`  classes_snapshot: ${classesSnapshot.length} classes`)
  console.log(`  teachers_snapshot: ${teachersSnapshot.length} teachers`)
  console.log(`  grades_snapshot: ${gradesSnapshot.length} grades`)
  console.log(`  rules_snapshot: ${rulesSnapshot.length} rules`)

  // 5. Update the generation record
  console.log('\nUpdating generation record...')
  const { error: updateError } = await supabase
    .from('schedule_generations')
    .update({ stats: newStats })
    .eq('id', generationId)

  if (updateError) {
    console.error('Failed to update generation:', updateError.message)
    process.exit(1)
  }

  console.log('\n✓ Successfully migrated schedule snapshot!\n')

  // Show sample of what was added
  console.log('Sample class snapshot:')
  if (classesSnapshot.length > 0) {
    console.log(JSON.stringify(classesSnapshot[0], null, 2))
  }
}

// Get generation ID from command line
const generationId = process.argv[2]

if (!generationId) {
  console.error('Usage: npx tsx scripts/migrate-schedule-snapshot.ts <generation_id>')
  console.error('\nYou can find the generation ID from the URL: /history/<generation_id>')
  process.exit(1)
}

migrateScheduleSnapshot(generationId)
