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
  grade: string;
  subject: string;
  daysPerWeek: number;
  availableDays?: string[];
  availableBlocks?: number[];
  fixedSlots?: [string, number][]; // [day, block][]
  restrictions?: Restriction[];
}

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

export interface ScheduleOption {
  optionNumber: number;
  seed: number;
  backToBackIssues: number;
  studyHallsPlaced: number;
  teacherSchedules: Record<string, TeacherSchedule>;
  gradeSchedules: Record<string, GradeSchedule>;
  studyHallAssignments: StudyHallAssignment[];
  teacherStats: TeacherStat[];
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
export const ALL_GRADES = [
  'Kindergarten',
  '1st Grade',
  '2nd Grade', 
  '3rd Grade',
  '4th Grade',
  '5th Grade',
  '6th Grade',
  '7th Grade',
  '8th Grade',
  '9th Grade',
  '10th Grade',
  '11th Grade',
] as const;

export type Day = typeof DAYS[number];
export type Block = typeof BLOCKS[number];
export type Grade = typeof ALL_GRADES[number];
