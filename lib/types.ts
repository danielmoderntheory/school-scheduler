// Types for the School Scheduler

export type EmploymentStatus = 'full-time' | 'part-time';

export interface Teacher {
  id?: string;
  name: string;
  status: EmploymentStatus;
  canSuperviseStudyHall?: boolean;
  notes?: string;
}

export interface Restriction {
  type: 'fixed_slot' | 'available_days' | 'available_blocks';
  value: { day: string; block: number } | string[] | number[];
}

export interface ClassEntry {
  id?: string;
  teacher: string;
  grade: string;  // Display name (legacy, kept for backward compat)
  grades?: string[];  // Array of grade names (legacy)
  gradeIds?: string[];  // Array of grade UUIDs (primary - use this for comparisons)
  gradeDisplay?: string;  // Display name for UI
  subject: string;
  daysPerWeek: number;
  isElective?: boolean;  // Electives skip grade conflicts
  isCotaught?: boolean;  // Co-taught classes must be scheduled at the same time
  availableDays?: string[];
  availableBlocks?: number[];
  fixedSlots?: [string, number][]; // [day, block][]
  restrictions?: Restriction[];
}

// Grade map for ID to display name lookup
export interface GradeInfo {
  id: string;
  name: string;
  displayName: string;
}

export type GradeMap = Map<string, GradeInfo>;

export interface Quarter {
  id: string;
  name: string;
  year: number;
  quarterNum: number;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  ruleKey: string;
  ruleType: 'hard' | 'soft';
  priority: number;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface StudyHallAssignment {
  group: string;
  teacher: string | null;
  day: string | null;
  block: number | null;
}

export interface TeacherStat {
  teacher: string;
  status: string;
  teaching: number;
  studyHall: number;
  open: number;
  totalUsed: number;
  backToBackIssues: number;
}

export interface ScheduleEntry {
  grade: string;
  subject: string;
}

export interface TeacherSchedule {
  [day: string]: {
    [block: number]: [string, string] | null; // [grade, subject] or null
  };
}

export interface GradeSchedule {
  [day: string]: {
    [block: number]: [string, string] | null; // [teacher, subject] or null
  };
}

// Labels for OPEN blocks - allows custom display text (e.g., "Prep Time", "Planning")
// Indexed by "Nth OPEN block for teacher" to survive regeneration
export interface OpenBlockLabels {
  // Available labels for dropdown (e.g., ["Prep Time", "Planning", "Meeting"])
  availableLabels: string[];
  // Assignments: teacher name → openIndex (0-based) → label
  assignments: {
    [teacher: string]: {
      [openIndex: number]: string;
    };
  };
}

export interface ScheduleOption {
  optionNumber: number;
  seed: number;
  backToBackIssues: number;
  studyHallsPlaced: number;
  teacherSchedules: Record<string, TeacherSchedule>;
  gradeSchedules: Record<string, GradeSchedule>;
  studyHallAssignments: StudyHallAssignment[];
  teacherStats: TeacherStat[];
  builtWithSnapshotVersion?: number; // Timestamp of snapshot this option was built with
  openBlockLabels?: OpenBlockLabels; // Custom display labels for OPEN blocks
}

// Lightweight solution for alternative browsing (no stats computed)
export interface AlternativeSolution {
  index: number;
  score: number;
  backToBackIssues: number;
  studyHallsPlaced: number;
  teacherSchedules: Record<string, TeacherSchedule>;
  gradeSchedules: Record<string, GradeSchedule>;
  studyHallAssignments: StudyHallAssignment[];
}

export interface GenerationResult {
  id?: string;
  quarterId: string;
  generatedAt: string;
  options: ScheduleOption[];
  selectedOption?: number;
  notes?: string;
}

// Constants
export const DAYS = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri'] as const;
export const BLOCKS = [1, 2, 3, 4, 5] as const;

export type Day = typeof DAYS[number];
export type Block = typeof BLOCKS[number];
// Grade type is now dynamic - grades come from the database
export type Grade = string;

// Freeform Mode Types
export interface CellLocation {
  teacher: string;
  day: string;
  block: number;
  grade?: string;
  subject?: string;
}

export interface FloatingBlock {
  id: string;
  sourceTeacher: string;
  sourceDay: string;
  sourceBlock: number;
  grade: string;
  subject: string;
  entry: [string, string];
  isDisplaced?: boolean; // true if picked up via chain (blocking another placement)
  transferredTo?: string; // target teacher name when block is part of a cross-teacher transfer
}

export interface PendingPlacement {
  blockId: string;
  teacher: string;
  day: string;
  block: number;
  previousEntry?: [string, string] | null; // What was in the cell before placement (for proper restore)
}

export interface PendingTransfer {
  id: string;
  fromTeacher: string;
  toTeacher: string;
  subject: string;
  grade: string;
  moveType: 'one' | 'all';
}

export interface ValidationError {
  type: 'teacher_conflict' | 'grade_conflict' | 'subject_conflict' | 'unplaced' | 'locked_teacher_missing' | 'locked_teacher_modified' | 'session_count' | 'study_hall_coverage' | 'back_to_back' | 'fixed_slot_violation' | 'availability_violation' | 'unknown_class';
  message: string;
  cells: CellLocation[];
  blockId?: string;
}
