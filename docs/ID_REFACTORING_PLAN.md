# ID-Based Architecture Refactoring Plan

## Goal
Refactor the scheduler system to use database IDs (UUIDs) internally throughout, only converting to display names at the output layer. This eliminates string parsing/comparison bugs and makes the system more robust.

## Current Problems
- Grade displays can be stored inconsistently ("10th-11th Grade" vs "10th Grade, 11th Grade")
- String parsing is fragile and duplicated across files
- Comparisons rely on exact string matches which can fail
- **`teacherSchedules` keys are teacher names.** Renaming a teacher (e.g. "Sarah" → "Sarah Smith") leaves the schedule keyed by the old name — a teacher that no longer exists in the DB. The grid shows stale data.
- **Schedule cell values store subject names as strings.** Renaming a subject (e.g. "Math" → "Mathematics") leaves old names frozen in saved schedules with no way to update them.
- **Snapshot comparison key is `teacher_name|grade_ids|subject_name`** (`classKey()` in `snapshot-utils.ts`). Renaming a teacher or subject breaks the key match — the old name appears as "removed" and the new name as "added", producing misleading change banners on the history page.
- **`revisionMatchesSnapshot()` uses `teacher_name|subject_name`** to verify a revision matches its snapshot. A rename causes counts to mismatch, incorrectly reporting the revision as diverged.
- All four issues are resolved by switching to ID-based keys and only converting to display names at the render layer.

## Proposed Architecture

### Internal Processing (use IDs)
- **Teachers**: Use `teacher_id` (UUID) for all comparisons and tracking
- **Grades**: Use `grade_id` (UUID) for constraint checking
- **Subjects**: Use `subject_id` (UUID) for subject/day conflict checking
- **Classes**: Use `class_id` (UUID) for class identity

### Output Layer (convert to display names)
- Teacher schedules: Convert teacher_id → teacher name at render
- Grade schedules: Convert grade_id → grade display name at render
- Exports: Convert all IDs to names when generating XLSX/CSV

### Data Structures

```typescript
// Internal session (for solver)
interface Session {
  id: number;
  classId: string;        // Database class UUID
  teacherId: string;      // Database teacher UUID
  gradeIds: string[];     // Database grade UUIDs
  subjectId: string;      // Database subject UUID
  validSlots: number[];
  isFixed: boolean;
  isElective?: boolean;
  cotaughtGroupId?: string;
}

// Lookup maps (passed alongside data)
interface EntityMaps {
  teachers: Map<string, { id: string; name: string; status: string }>;
  grades: Map<string, { id: string; name: string; displayName: string }>;
  subjects: Map<string, { id: string; name: string }>;
}

// Output schedules (keyed by ID, converted to names at render)
interface TeacherScheduleById {
  [teacherId: string]: {
    [day: string]: {
      [block: number]: { gradeIds: string[]; subjectId: string } | null;
    };
  };
}
```

## Files to Update

### 1. types.ts
- Add ID fields to ClassEntry, Teacher interfaces
- Add EntityMaps type
- Add ID-based schedule types (or keep current types for backward compat)

### 2. snapshot-utils.ts
- `parseClassesFromSnapshot`: Return gradeIds, teacherId, subjectId
- `buildEntityMapsFromSnapshot`: Build lookup maps from snapshot data
- Keep display name generation for backward compat

### 3. scheduler.ts
- Session interface: Use IDs instead of names
- `buildSessions`: Extract IDs from ClassEntry
- `solveBacktracking`: All constraint tracking uses ID sets
- `buildSchedules`: Use IDs for internal structure, convert at end
- `lockedGradeSlots`: Key by grade ID, not grade name
- Remove all `parseGrades`, `parseGradesFromDatabase` calls from solver logic

### 4. grade-utils.ts
- Keep display formatting functions
- Add ID-based helpers if needed
- Remove string parsing functions (or deprecate)

### 5. History page (app/(authenticated)/history/[id]/page.tsx)
- Pass entity maps to components
- ScheduleGrid receives maps for display name lookup

### 6. ScheduleGrid.tsx
- Accept entity maps prop
- Convert IDs to display names at render time

### 7. Export (lib/export.ts)
- Convert IDs to names when generating export data

## Migration Strategy

1. **Phase 1**: Add ID fields alongside existing string fields (backward compat)
2. **Phase 2**: Update solver to use IDs internally
3. **Phase 3**: Update output/display layer to use maps
4. **Phase 4**: Remove deprecated string parsing code

## Benefits
- No string parsing bugs (comma-separated, ranges, etc.)
- Faster comparisons (UUID equality vs string parsing)
- Handles entity renames gracefully
- Consistent with database structure
- Single source of truth for entity identity

## Risks
- Large refactoring touches many files
- Need to maintain backward compat with existing stored schedules
- Testing required across all generation and display paths
