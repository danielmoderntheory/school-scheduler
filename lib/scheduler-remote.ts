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

/**
 * ClassEntry plus the double-period flag. Kept as a local extension so callers
 * can thread `subjects.requires_double_periods` through without widening the
 * shared ClassEntry type; sent to the solver as per-class `is_double`.
 */
export type RemoteClassEntry = ClassEntry & {
  isDouble?: boolean;
};

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
  blocks?: number[]; // Block numbers from the quarter's timetable template (absent = legacy [1..5])
  gradeTeachableBlocks?: Record<string, number[]>; // grade NAME -> teachable block numbers (absent = all blocks)
  gradeBlockPairs?: Record<string, [number, number][]>; // grade NAME -> consecutive block pairs legal for double periods
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
  unlockSuggestions?: Array<{
    teacher: string;
    shared_sessions: number;
    feasible: boolean;
    options_found: number;
    impact: 'high' | 'medium' | 'low';
    is_pair?: boolean;
    teachers?: string[];  // For pair suggestions
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

// Direct Cloud Run URL - bypasses Vercel's 10s timeout limit
// Set via NEXT_PUBLIC_SOLVER_URL environment variable
const DIRECT_SOLVER_URL = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_SOLVER_URL || '')
  : '';

/**
 * Generate schedules using the remote OR-Tools solver.
 *
 * Tries direct Cloud Run first (no Vercel timeout), falls back to Vercel proxy.
 */
export async function generateSchedulesRemote(
  teachers: Teacher[],
  classes: RemoteClassEntry[],
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
    blocks,
    gradeTeachableBlocks,
    gradeBlockPairs,
  } = options;

  // Allow UI to render before starting
  await new Promise(resolve => setTimeout(resolve, 0));
  onProgress?.(0, numAttempts, 'Warming up solver...');

  // Determine which endpoint to use for warmup
  const warmupUrl = DIRECT_SOLVER_URL
    ? `${DIRECT_SOLVER_URL}/health`
    : '/api/solve-remote/health';

  // Warmup: ping health endpoint to wake up Cloud Run container before heavy request
  try {
    const warmupResponse = await fetch(warmupUrl, { method: 'GET' });
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
        availableDays: t.availableDays || null,
        availableBlocks: t.availableBlocks || null,
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
        is_double: c.isDouble || false,     // Subject requires double periods (consecutive-block pairs)
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
      // Per-quarter block format; undefined keys are omitted from the JSON body,
      // which the solver treats as the legacy 5-block format.
      blocks,
      grade_teachable_blocks: gradeTeachableBlocks,
      grade_block_pairs: gradeBlockPairs,
    };

    // Start simulated progress (since we can't get real progress from the API)
    // Base progress on time, not attempts, since solver runs for maxTimeSeconds
    const startTime = Date.now();
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let completed = false;

    const stopProgress = () => {
      completed = true;
      if (progressInterval) clearInterval(progressInterval);
    };

    const startProgressSimulation = () => {
      progressInterval = setInterval(() => {
        if (completed) {
          if (progressInterval) clearInterval(progressInterval);
          return;
        }

        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        // Progress reaches ~95% at maxTimeSeconds, leaving room for post-processing
        const progressPercent = Math.min(95, (elapsedSeconds / maxTimeSeconds) * 100);
        const displayProgress = Math.floor((progressPercent / 100) * numAttempts);

        if (elapsedSeconds < maxTimeSeconds) {
          onProgress?.(displayProgress, numAttempts, `Solving with OR-Tools CP-SAT... (~${elapsedSeconds}s)`);
        } else {
          // Past expected time, show "finishing up" message
          onProgress?.(-1, numAttempts, 'Finishing up and gathering results...');
        }
      }, 1000);
    };

    onProgress?.(1, numAttempts, 'Solving with OR-Tools CP-SAT...');
    startProgressSimulation();

    let response: Response;
    let usedDirectConnection = false;

    // Try direct Cloud Run first (bypasses Vercel's 10s timeout limit)
    if (DIRECT_SOLVER_URL) {
      try {
        response = await fetch(`${DIRECT_SOLVER_URL}/solve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });
        usedDirectConnection = true;
      } catch (directError) {
        console.warn('[Solver] Direct Cloud Run failed, falling back to Vercel proxy:', directError);
        // Fall through to Vercel proxy
        response = await fetch('/api/solve-remote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });
      }
    } else {
      // No direct URL configured, use Vercel proxy
      response = await fetch('/api/solve-remote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    }

    // Stop progress simulation
    stopProgress();

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));

      // Detect Vercel timeout (504 or specific timeout message)
      const isTimeout = response.status === 504 ||
        errorData.message?.includes('FUNCTION_INVOCATION_TIMEOUT') ||
        errorData.message?.includes('Task timed out');

      if (isTimeout) {
        console.error('[Vercel Timeout] Solver request exceeded time limit:', {
          status: response.status,
          message: errorData.message,
          hint: 'Consider reducing numAttempts or maxTimeSeconds, or upgrading Vercel plan'
        });
      }

      return {
        status: 'error',
        options: [],
        message: isTimeout
          ? 'Solver timed out - trying next strategy...'
          : (errorData.message || `Server returned ${response.status}`),
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
    const errorMessage = error instanceof Error ? error.message : 'Failed to connect to solver';

    // Detect timeout-related errors at the network level
    const isTimeout = errorMessage.includes('timeout') ||
      errorMessage.includes('TIMEOUT') ||
      errorMessage.includes('aborted');

    if (isTimeout) {
      console.error('[Vercel/Network Timeout] Solver request failed:', {
        error: errorMessage,
        hint: 'Request may have exceeded Vercel function timeout limit'
      });
    } else {
      console.error('Remote solver error:', error);
    }

    return {
      status: 'error',
      options: [],
      message: isTimeout ? 'Solver timed out - trying next strategy...' : errorMessage,
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
