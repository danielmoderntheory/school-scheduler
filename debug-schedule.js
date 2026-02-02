// Debug script to analyze schedule data
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rihjdxzqexmwyfzvqxac.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpaGpkeHpxZXhtd3lmenZxeGFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NzQ3ODAsImV4cCI6MjA4NTE1MDc4MH0.JivHa2OC4RcZFg77VbARl6xSjlZUIRiLohkj8rYDaWs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeSchedule(scheduleId) {
  const { data, error } = await supabase
    .from('schedule_generations')
    .select('options')
    .eq('id', scheduleId)
    .single();

  if (error) {
    console.error('Error fetching schedule:', error);
    return;
  }

  const option = data.options[0];
  const teacherSchedules = option.teacherSchedules;
  const gradeSchedules = option.gradeSchedules;

  // Find Art Teacher, Miguel schedules
  const teachersToCheck = ['Art Teacher', 'Miguel'];
  const subjectsToFind = ['Art 101', 'Robotics A', 'Robotics B', 'AutoCAD'];

  console.log('\n=== TEACHER SCHEDULES ===');
  for (const teacher of teachersToCheck) {
    const schedule = teacherSchedules[teacher];
    if (!schedule) {
      console.log(`${teacher}: NOT FOUND`);
      continue;
    }
    console.log(`\n${teacher}:`);
    for (const day of ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']) {
      for (const block of [1, 2, 3, 4, 5]) {
        const entry = schedule[day]?.[block];
        if (entry && subjectsToFind.includes(entry[1])) {
          console.log(`  ${day} B${block}: grade_display="${entry[0]}", subject="${entry[1]}"`);
        }
      }
    }
  }

  // Check what's in specific slots
  console.log('\n=== CHECKING SPECIFIC SLOTS IN GRADE SCHEDULES ===');
  const slotsToCheck = [
    { day: 'Mon', block: 5 },  // Robotics A
    { day: 'Wed', block: 5 },  // AutoCAD
    { day: 'Fri', block: 1 },  // Art 101 + Robotics B
  ];
  for (const slot of slotsToCheck) {
    console.log(`\n${slot.day} B${slot.block}:`);
    for (const grade of ['6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade']) {
      const entry = gradeSchedules[grade]?.[slot.day]?.[slot.block];
      console.log(`  ${grade}: ${entry ? `${entry[0]} / ${entry[1]}` : '(empty)'}`);
    }
  }

  console.log('\n=== GRADE SCHEDULES (looking for these subjects) ===');
  const gradesWithSubjects = {};
  for (const grade of Object.keys(gradeSchedules)) {
    const schedule = gradeSchedules[grade];
    for (const day of ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']) {
      for (const block of [1, 2, 3, 4, 5]) {
        const entry = schedule[day]?.[block];
        if (entry && subjectsToFind.includes(entry[1])) {
          if (!gradesWithSubjects[entry[1]]) {
            gradesWithSubjects[entry[1]] = [];
          }
          gradesWithSubjects[entry[1]].push({ grade, day, block, teacher: entry[0] });
        }
      }
    }
  }

  for (const subject of subjectsToFind) {
    const entries = gradesWithSubjects[subject] || [];
    console.log(`\n${subject}: ${entries.length} entries in grade schedules`);
    for (const e of entries) {
      console.log(`  ${e.grade} ${e.day} B${e.block}: ${e.teacher}`);
    }
  }
}

// Get schedule ID from command line or use default
const scheduleId = process.argv[2] || 'e715e127-bd0e-47da-ae6c-27e50d9bb45a';
analyzeSchedule(scheduleId);
