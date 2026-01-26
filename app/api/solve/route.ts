import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

// Constants
const DAYS = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri'];
const BLOCKS = [1, 2, 3, 4, 5];

const ALL_GRADES = [
  'Kindergarten', '1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade',
  '6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade'
];

const GRADE_MAP: Record<string, string[]> = {
  'Kindergarten': ['Kindergarten'],
  'Kingergarten': ['Kindergarten'],
  '1st Grade': ['1st Grade'],
  '2nd Grade': ['2nd Grade'],
  '3rd Grade': ['3rd Grade'],
  '4th Grade': ['4th Grade'],
  '5th Grade': ['5th Grade'],
  '6th Grade': ['6th Grade'],
  '7th Grade': ['7th Grade'],
  '8th Grade': ['8th Grade'],
  '9th Grade': ['9th Grade'],
  '10th Grade': ['10th Grade'],
  '11th Grade': ['11th Grade'],
  '6th-7th Grade': ['6th Grade', '7th Grade'],
  '10th-11th Grade': ['10th Grade', '11th Grade'],
};

interface Session {
  id: number;
  teacher: string;
  grade: string;
  subject: string;
  validSlots: number[];
}

function slotToDay(slot: number): number {
  return Math.floor(slot / 5);
}

function parseGrades(gradeField: string): string[] {
  if (gradeField.includes('Elective')) return [];
  return GRADE_MAP[gradeField.trim()] || [];
}

function varName(sessionId: number, slot: number): string {
  return `x_${sessionId}_${slot}`;
}

function mulberry32(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildMIPProblem(sessions: Session[], seed: number = 0): string {
  const lines: string[] = [];
  const allVars: string[] = [];

  // Collect all variables
  sessions.forEach(s => {
    s.validSlots.forEach(slot => {
      allVars.push(varName(s.id, slot));
    });
  });

  // Handle empty problem
  if (allVars.length === 0) {
    throw new Error('No variables to solve - check that sessions have valid slots');
  }

  // Objective: minimize with small random coefficients for variety
  lines.push('Minimize');
  const rng = mulberry32(seed || 1);
  // Use coefficients between 0.001 and 0.002 to ensure non-zero values
  const terms = allVars.map(v => `${(0.001 + rng() * 0.001).toFixed(6)} ${v}`);
  lines.push(' obj: ' + terms.join(' + '));

  lines.push('Subject To');
  let constraintId = 0;

  // Constraint 1: Each session assigned exactly once
  sessions.forEach(s => {
    const terms = s.validSlots.map(slot => varName(s.id, slot));
    if (terms.length > 0) {
      lines.push(` c${constraintId++}: ${terms.join(' + ')} = 1`);
    }
  });

  // Constraint 2: No teacher conflicts (at most 1 session per teacher per slot)
  const teacherNames = [...new Set(sessions.map(s => s.teacher))];
  teacherNames.forEach(teacher => {
    const teacherSessions = sessions.filter(s => s.teacher === teacher);
    for (let slot = 0; slot < 25; slot++) {
      const terms = teacherSessions
        .filter(s => s.validSlots.includes(slot))
        .map(s => varName(s.id, slot));
      if (terms.length > 1) {
        lines.push(` c${constraintId++}: ${terms.join(' + ')} <= 1`);
      }
    }
  });

  // Constraint 3: No grade conflicts (at most 1 session per grade per slot)
  ALL_GRADES.forEach(grade => {
    for (let slot = 0; slot < 25; slot++) {
      const terms: string[] = [];
      sessions.forEach(s => {
        const grades = parseGrades(s.grade);
        if (grades.includes(grade) && s.validSlots.includes(slot)) {
          terms.push(varName(s.id, slot));
        }
      });
      if (terms.length > 1) {
        lines.push(` c${constraintId++}: ${terms.join(' + ')} <= 1`);
      }
    }
  });

  // Constraint 4: No same subject twice per day per grade
  ALL_GRADES.forEach(grade => {
    const subjectsForGrade = new Set<string>();
    sessions.forEach(s => {
      const grades = parseGrades(s.grade);
      if (grades.includes(grade)) {
        subjectsForGrade.add(s.subject);
      }
    });

    subjectsForGrade.forEach(subject => {
      for (let day = 0; day < 5; day++) {
        const terms: string[] = [];
        sessions.forEach(s => {
          const grades = parseGrades(s.grade);
          if (grades.includes(grade) && s.subject === subject) {
            s.validSlots.forEach(slot => {
              if (slotToDay(slot) === day) {
                terms.push(varName(s.id, slot));
              }
            });
          }
        });
        if (terms.length > 1) {
          lines.push(` c${constraintId++}: ${terms.join(' + ')} <= 1`);
        }
      }
    });
  });

  // Bounds section (all variables are binary, so 0-1)
  lines.push('Bounds');
  allVars.forEach(v => {
    lines.push(` 0 <= ${v} <= 1`);
  });

  // Binary variables
  lines.push('Binary');
  lines.push(' ' + allVars.join(' '));

  lines.push('End');

  return lines.join('\n');
}

// Create fresh HiGHS instance each time (cached instance can get into bad state after errors)
async function getHiGHS() {
  const highs = await import('highs')

  // Load WASM file manually from node_modules
  const wasmPath = path.join(process.cwd(), 'node_modules', 'highs', 'build', 'highs.wasm')
  const wasmBinary = fs.readFileSync(wasmPath)

  return await highs.default({
    wasmBinary
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { sessions, seed = 0 } = body as { sessions: Session[]; seed: number }

  // Debug: log session info on first attempt
  if (seed === 0) {
    console.log('Sessions received:', sessions.length)
    console.log('First session:', JSON.stringify(sessions[0], null, 2))
  }

  try {
    const highs = await getHiGHS()

    const problem = buildMIPProblem(sessions, seed)

    // Debug: save LP to file on first attempt for inspection
    if (seed === 0) {
      console.log('LP Problem length:', problem.length)
      fs.writeFileSync('/tmp/debug-lp.txt', problem)
      console.log('LP saved to /tmp/debug-lp.txt')
    }

    const solution = highs.solve(problem)

    if (solution.Status !== 'Optimal') {
      console.log('HiGHS status:', solution.Status)
      return NextResponse.json({
        success: false,
        status: solution.Status,
        assignment: null
      })
    }

    // Extract assignment from solution
    const assignment: Record<number, number> = {}

    if (solution.Columns) {
      Object.entries(solution.Columns).forEach(([vName, data]) => {
        if (data && typeof data === 'object' && 'Primal' in data && (data as { Primal: number }).Primal > 0.5) {
          const match = vName.match(/x_(\d+)_(\d+)/)
          if (match) {
            const sessionId = parseInt(match[1])
            const slot = parseInt(match[2])
            assignment[sessionId] = slot
          }
        }
      })
    }

    return NextResponse.json({
      success: true,
      status: 'Optimal',
      assignment
    })
  } catch (error) {
    console.error('MIP solver error:', error)
    return NextResponse.json({
      success: false,
      status: 'Error',
      error: String(error),
      assignment: null
    }, { status: 500 })
  }
}
