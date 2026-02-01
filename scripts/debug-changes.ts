/**
 * Debug script to compare snapshot vs current classes
 * Run with: npx tsx scripts/debug-changes.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const GENERATION_ID = 'd92d7795-50ba-4d9c-87af-5a31cfaefd01'

async function debug() {
  // Fetch the generation
  const { data: generation, error: genError } = await supabase
    .from('schedule_generations')
    .select('*, quarter:quarters(id, name)')
    .eq('id', GENERATION_ID)
    .single()

  if (genError || !generation) {
    console.error('Failed to fetch generation:', genError?.message)
    return
  }

  console.log('Generation:', generation.id)
  console.log('Quarter:', generation.quarter?.name)

  const snapshot = generation.stats?.classes_snapshot || []
  console.log('\n=== SNAPSHOT CLASSES ===')
  console.log('Count:', snapshot.length)

  // Fetch current classes
  const { data: currentClasses, error: classesError } = await supabase
    .from('classes')
    .select(`
      *,
      teacher:teachers(id, name),
      grade:grades(id, name, display_name),
      subject:subjects(id, name),
      restrictions(*)
    `)
    .eq('quarter_id', generation.quarter_id)

  if (classesError) {
    console.error('Failed to fetch classes:', classesError.message)
    return
  }

  console.log('\n=== CURRENT CLASSES ===')
  console.log('Count:', currentClasses?.length || 0)

  // Build keys for comparison
  function classKey(teacherName: string, gradeIds: string[] | null, subjectName: string): string {
    const grades = gradeIds || []
    const sortedGrades = [...grades].sort()
    return `${teacherName}|${sortedGrades.join(',')}|${subjectName}`
  }

  // Build snapshot map
  const snapshotMap = new Map<string, any>()
  for (const cls of snapshot) {
    const key = classKey(
      cls.teacher_name || '',
      cls.grade_ids || [],
      cls.subject_name || ''
    )
    snapshotMap.set(key, cls)
  }

  // Build current map
  const currentMap = new Map<string, any>()
  for (const cls of currentClasses || []) {
    const gradeIds = cls.grade_ids?.length
      ? cls.grade_ids
      : (cls.grade?.id ? [cls.grade.id] : [])

    const key = classKey(
      cls.teacher?.name || '',
      gradeIds,
      cls.subject?.name || ''
    )
    currentMap.set(key, cls)
  }

  console.log('\n=== COMPARISON ===')
  console.log('Snapshot keys:', snapshotMap.size)
  console.log('Current keys:', currentMap.size)

  // Find differences
  const added: string[] = []
  const removed: string[] = []
  const modified: string[] = []

  // Check for added and modified
  for (const [key, current] of currentMap) {
    const snap = snapshotMap.get(key)
    if (!snap) {
      added.push(key)
    } else {
      // Check for modifications
      const diffs: string[] = []

      if (snap.days_per_week !== current.days_per_week) {
        diffs.push(`days_per_week: ${snap.days_per_week} -> ${current.days_per_week}`)
      }

      // Compare restrictions
      const snapRestrictions = (snap.restrictions || [])
        .map((r: any) => ({ type: r.restriction_type, value: JSON.stringify(r.value) }))
        .sort((a: any, b: any) => a.type.localeCompare(b.type))

      const currentRestrictions = (current.restrictions || [])
        .map((r: any) => ({ type: r.restriction_type, value: JSON.stringify(r.value) }))
        .sort((a: any, b: any) => a.type.localeCompare(b.type))

      if (JSON.stringify(snapRestrictions) !== JSON.stringify(currentRestrictions)) {
        diffs.push(`restrictions differ`)
        console.log('\n  Restriction diff for:', key)
        console.log('    Snapshot:', JSON.stringify(snapRestrictions))
        console.log('    Current:', JSON.stringify(currentRestrictions))
      }

      if (diffs.length > 0) {
        modified.push(`${key} (${diffs.join(', ')})`)
      }
    }
  }

  // Check for removed
  for (const key of snapshotMap.keys()) {
    if (!currentMap.has(key)) {
      removed.push(key)
    }
  }

  console.log('\n=== RESULTS ===')
  console.log('Added:', added.length)
  if (added.length > 0 && added.length <= 10) {
    added.forEach(k => console.log('  +', k))
  }

  console.log('Removed:', removed.length)
  if (removed.length > 0 && removed.length <= 10) {
    removed.forEach(k => console.log('  -', k))
  }

  console.log('Modified:', modified.length)
  if (modified.length > 0 && modified.length <= 10) {
    modified.forEach(k => console.log('  ~', k))
  }

  // Sample a few classes to see the raw data
  console.log('\n=== SAMPLE DATA ===')
  const sampleSnap = snapshot[0]
  const sampleCurrent = currentClasses?.[0]

  console.log('Sample snapshot class:')
  console.log('  teacher_name:', sampleSnap?.teacher_name)
  console.log('  grade_ids:', sampleSnap?.grade_ids)
  console.log('  subject_name:', sampleSnap?.subject_name)
  console.log('  days_per_week:', sampleSnap?.days_per_week)
  console.log('  restrictions:', JSON.stringify(sampleSnap?.restrictions))

  console.log('\nSample current class:')
  console.log('  teacher.name:', sampleCurrent?.teacher?.name)
  console.log('  grade_ids:', sampleCurrent?.grade_ids)
  console.log('  grade.id:', sampleCurrent?.grade?.id)
  console.log('  subject.name:', sampleCurrent?.subject?.name)
  console.log('  days_per_week:', sampleCurrent?.days_per_week)
  console.log('  restrictions:', JSON.stringify(sampleCurrent?.restrictions?.map((r: any) => ({ restriction_type: r.restriction_type, value: r.value }))))
}

debug()
