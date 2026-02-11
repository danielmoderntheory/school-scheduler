import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"
import { formatQuarterName } from "@/lib/types"

export async function GET() {
  const { data, error } = await supabase
    .from("quarters")
    .select("*")
    .is("deleted_at", null)
    .order("year", { ascending: false })
    .order("quarter_num", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Check if any quarters exist
  const { data: existing } = await supabase
    .from("quarters")
    .select("id")
    .limit(1)

  const isFirst = !existing || existing.length === 0

  const name = formatQuarterName(body.quarter_num, body.year)

  // Create the new quarter
  const { data: newQuarter, error } = await supabase
    .from("quarters")
    .insert({
      name,
      year: body.year,
      quarter_num: body.quarter_num,
      is_active: isFirst, // Auto-activate first quarter
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This quarter already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let classesCopied = 0

  // Copy classes from another quarter if specified
  if (body.copy_from_quarter_id) {
    // Get classes from source quarter with their restrictions
    const { data: sourceClasses, error: classesError } = await supabase
      .from("classes")
      .select(`
        teacher_id,
        grade_id,
        subject_id,
        days_per_week,
        restrictions (
          restriction_type,
          value
        )
      `)
      .eq("quarter_id", body.copy_from_quarter_id)

    if (!classesError && sourceClasses && sourceClasses.length > 0) {
      // Insert classes for new quarter
      const newClasses = sourceClasses.map((c) => ({
        teacher_id: c.teacher_id,
        grade_id: c.grade_id,
        subject_id: c.subject_id,
        days_per_week: c.days_per_week,
        quarter_id: newQuarter.id,
      }))

      const { data: insertedClasses, error: insertError } = await supabase
        .from("classes")
        .insert(newClasses)
        .select("id")

      if (!insertError && insertedClasses) {
        classesCopied = insertedClasses.length

        // Copy restrictions for each class
        const allRestrictions: Array<{
          class_id: string
          restriction_type: string
          value: unknown
        }> = []

        for (let i = 0; i < sourceClasses.length; i++) {
          const sourceClass = sourceClasses[i]
          const newClassId = insertedClasses[i]?.id

          if (newClassId && sourceClass.restrictions) {
            for (const r of sourceClass.restrictions) {
              allRestrictions.push({
                class_id: newClassId,
                restriction_type: r.restriction_type,
                value: r.value,
              })
            }
          }
        }

        if (allRestrictions.length > 0) {
          await supabase.from("restrictions").insert(allRestrictions)
        }
      }
    }
  }

  // Activate the new quarter
  if (!isFirst) {
    // Deactivate all other quarters
    await supabase
      .from("quarters")
      .update({ is_active: false })
      .neq("id", newQuarter.id)

    // Activate the new one
    await supabase
      .from("quarters")
      .update({ is_active: true })
      .eq("id", newQuarter.id)
  }

  return NextResponse.json({ ...newQuarter, classes_copied: classesCopied })
}
