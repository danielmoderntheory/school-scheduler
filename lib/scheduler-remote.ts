/**
 * Remote scheduler client - calls the Cloud Run OR-Tools backend.
 *
 * Use this for production deployments where you want the power of
 * OR-Tools CP-SAT solver instead of the client-side backtracking solver.
 */

import type {
  Teacher, ClassEntry, ScheduleOption
} from './types';

export interface SchedulingRule {
  rule_key: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface RemoteGeneratorOptions {
  numOptions?: number;
  numAttempts?: number;
  maxTimeSeconds?: number;
  onProgress?: (current: number, total: number, message: string) => void;
  rules?: SchedulingRule[];
  lockedTeachers?: Record<string, Record<string, Record<number, [string, string] | null>>>; // For partial regen
  teachersNeedingStudyHalls?: string[]; // Teachers that need study halls assigned
  startSeed?: number; // Starting seed for solver randomization (increment for variety on re-runs)
  skipTopSolutions?: number; // Skip the top N solutions and return next best (for variety)
  randomizeScoring?: boolean; // Add noise to scoring for variety (picks suboptimal but valid solutions)
  skipStudyHalls?: boolean; // If true, skip study hall assignment during regen (reassign after saving)
  grades?: string[]; // All grade names from database - used for grade schedule initialization
}

export interface ScheduleDiagnostics {
  totalSessions?: number;
  fixedSessions?: number;
  solverStatus?: string;
  preflightErrors?: string[];
  incompleteClasses?: Array<{
    index: number;
    teacher: string;
    subject: string;
    grades: string[];
    issues: string[];
  }>;
  teacherOverload?: Array<{ teacher: string; sessions: number }>;
  gradeOverload?: Array<{ grade: string; sessions: number }>;
  fixedSlotConflicts?: Array<{
    teacher: string;
    day: string;
    block: number;
    class1: { subject: string; grades: string[] };
    class2: { subject: string; grades: string[] };
  }>;
  cotaughtClasses?: Array<{
    grade: string;
    subject: string;
    teachers: string[];
  }>;
  cotaughtConstraints?: number;
  cotaughtMismatches?: Array<{
    grade: string;
    subject: string;
    teacher1: string;
    sessions1: number;
    teacher2: string;
    sessions2: number;
  }>;
}

export interface RemoteGeneratorResult {
  status: 'success' | 'infeasible' | 'error';
  options: ScheduleOption[];
  allSolutions?: Array<{
    index: number;
    score: number;
    backToBackIssues: number;
    studyHallsPlaced: number;
    teacherSchedules: Record<string, unknown>;
    gradeSchedules: Record<string, unknown>;
    studyHallAssignments: Array<{
      group: string;
      teacher: string | null;
      day: string | null;
      block: number | null;
    }>;
  }>;
  message: string;
  seedsCompleted?: number;
  infeasibleCount?: number;
  elapsedSeconds?: number;
  diagnostics?: ScheduleDiagnostics;
}

/**
 * Generate schedules using the remote OR-Tools solver.
 *
 * Calls the /api/solve-remote endpoint which proxies to Cloud Run.
 */
export async function generateSchedulesRemote(
  teachers: Teacher[],
  classes: ClassEntry[],
  options: RemoteGeneratorOptions = {}
): Promise<RemoteGeneratorResult> {
  const {
    numOptions = 3,
    numAttempts = 150,
    maxTimeSeconds = 280,
    onProgress,
    rules = [],
    lockedTeachers,
    teachersNeedingStudyHalls,
    startSeed = 0,
    skipTopSolutions = 0,
    randomizeScoring = false,
    skipStudyHalls = false,
    grades,
  } = options;

  // Allow UI to render before starting
  await new Promise(resolve => setTimeout(resolve, 0));
  onProgress?.(0, numAttempts, 'Warming up solver...');

  // Warmup: ping health endpoint to wake up Cloud Run container before heavy request
  try {
    const warmupResponse = await fetch('/api/solve-remote/health', { method: 'GET' });
    if (!warmupResponse.ok) {
      console.warn('Solver warmup failed, proceeding anyway:', warmupResponse.status);
    }
  } catch (warmupError) {
    console.warn('Solver warmup failed, proceeding anyway:', warmupError);
  }

  onProgress?.(0, numAttempts, 'Connecting to OR-Tools solver...');
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    // Convert to API format
    const requestBody = {
      teachers: teachers.map(t => ({
        name: t.name,
        status: t.status,
        canSuperviseStudyHall: t.canSuperviseStudyHall,  // null = eligible, false = excluded
      })),
      classes: classes.map(c => ({
        teacher: c.teacher,
        grade: c.grade,
        grades: c.grades,  // New: array of grade names
        gradeDisplay: c.gradeDisplay,
        subject: c.subject,
        daysPerWeek: c.daysPerWeek,
        isElective: c.isElective || false,  // Electives skip grade conflicts
        isCotaught: c.isCotaught || false,  // Co-taught classes scheduled together
        availableDays: c.availableDays,
        availableBlocks: c.availableBlocks,
        fixedSlots: c.fixedSlots,
      })),
      rules: rules.map(r => ({
        rule_key: r.rule_key,
        enabled: r.enabled,
        config: r.config,
      })),
      numOptions,
      numAttempts,
      maxTimeSeconds,
      lockedTeachers,
      teachersNeedingStudyHalls,
      startSeed,
      skipTopSolutions,
      randomizeScoring,
      skipStudyHalls,
      grades,
    };

    // Start simulated progress (since we can't get real progress from the API)
    let simulatedProgress = 1;
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let completed = false;
    let reachedEnd = false;

    const startProgressSimulation = () => {
      progressInterval = setInterval(() => {
        if (completed) {
          if (progressInterval) clearInterval(progressInterval);
          return;
        }

        if (!reachedEnd) {
          // Logarithmic progress that reaches 100%
          simulatedProgress = Math.min(simulatedProgress + Math.max(1, Math.floor((numAttempts - simulatedProgress) / 20)), numAttempts);
          const elapsed = Math.floor((simulatedProgress / numAttempts) * maxTimeSeconds);
          onProgress?.(simulatedProgress, numAttempts, `Solving with OR-Tools CP-SAT... (~${elapsed}s)`);

          // Once we reach 100%, switch to "finishing up" message
          if (simulatedProgress >= numAttempts) {
            reachedEnd = true;
          }
        } else {
          // Show "finishing up" message - use -1 to signal UI to show activity indicator instead of counter
          onProgress?.(-1, numAttempts, 'Finishing up and gathering results...');
        }
      }, 1000);
    };

    onProgress?.(1, numAttempts, 'Solving with OR-Tools CP-SAT...');
    startProgressSimulation();

    const response = await fetch('/api/solve-remote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Stop progress simulation
    completed = true;
    if (progressInterval) clearInterval(progressInterval);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      return {
        status: 'error',
        options: [],
        message: errorData.message || `Server returned ${response.status}`,
      };
    }

    const result = await response.json();

    onProgress?.(numAttempts, numAttempts, 'Complete!');

    return {
      status: result.status,
      options: result.options || [],
      allSolutions: result.allSolutions || [],
      message: result.message || '',
      seedsCompleted: result.seedsCompleted,
      infeasibleCount: result.infeasibleCount,
      elapsedSeconds: result.elapsedSeconds,
      diagnostics: result.diagnostics,
    };

  } catch (error) {
    console.error('Remote solver error:', error);
    return {
      status: 'error',
      options: [],
      message: error instanceof Error ? error.message : 'Failed to connect to solver',
    };
  }
}

/**
 * Check if the remote solver is available.
 */
export async function checkRemoteSolverHealth(): Promise<boolean> {
  try {
    const response = await fetch('/api/solve-remote/health', {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}
