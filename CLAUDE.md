# School Schedule Generator

## Project Overview

A web application for generating optimized K-11th grade school schedules using constraint programming. Built for Journey School to create quarterly teacher schedules that satisfy complex constraints while minimizing scheduling conflicts.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Solver**: Pure JavaScript backtracking solver (runs client-side!)
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Vercel only (no separate backend needed!)
- **Auth**: Simple password protection via middleware

### Solver Architecture

We use a **custom JavaScript constraint solver** instead of Python OR-Tools:
- Runs entirely in the browser (client-side)
- No server timeouts to worry about
- ~50 attempts with randomized backtracking
- Typically finds solution in 1-5 seconds
- Falls back to HiGHS WASM for complex cases

## Project Structure

```
school-scheduler/
├── app/
│   ├── page.tsx             # Main dashboard
│   ├── teachers/            # Teacher management
│   ├── classes/             # Class/subject management  
│   ├── rules/               # Scheduling rules config
│   ├── generate/            # Schedule generation (runs client-side!)
│   ├── history/             # Past schedules
│   └── api/                 # API routes for Supabase
├── components/
│   ├── ui/                  # Reusable UI components (shadcn)
│   ├── TeacherForm.tsx
│   ├── ClassForm.tsx
│   ├── RulesEditor.tsx
│   ├── ScheduleGrid.tsx
│   └── ScheduleTabs.tsx
├── lib/
│   ├── supabase.ts          # Database client
│   ├── scheduler.ts         # JavaScript constraint solver
│   ├── types.ts             # TypeScript types
│   └── export.ts            # XLS/CSV export utilities
├── middleware.ts            # Password protection
└── CLAUDE.md                # This file
```

## Database Schema

### Tables

```sql
-- Teachers
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('full-time', 'part-time')),
  can_supervise_study_hall BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grades
CREATE TABLE grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL
);

-- Subjects
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE
);

-- Classes (teacher + grade + subject assignments)
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  grade_id UUID REFERENCES grades(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  days_per_week INT NOT NULL CHECK (days_per_week BETWEEN 1 AND 5),
  quarter_id UUID REFERENCES quarters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(teacher_id, grade_id, subject_id, quarter_id)
);

-- Restrictions (fixed slots, availability)
CREATE TABLE restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  restriction_type TEXT NOT NULL CHECK (restriction_type IN ('fixed_slot', 'available_days', 'available_blocks')),
  value JSONB NOT NULL,
  -- fixed_slot: {"day": "Mon", "block": 5}
  -- available_days: ["Mon", "Wed"]
  -- available_blocks: [3, 4, 5]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduling Rules (configurable constraints)
CREATE TABLE rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  rule_type TEXT NOT NULL,
  is_hard_constraint BOOLEAN DEFAULT true,
  priority INT DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quarters
CREATE TABLE quarters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  year INT NOT NULL,
  quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(year, quarter)
);

-- Generated Schedules (history)
CREATE TABLE schedule_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id UUID REFERENCES quarters(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  options JSONB NOT NULL,  -- Array of schedule options
  stats JSONB,             -- {back_to_back_issues, study_halls_placed, etc}
  selected_option INT,     -- Which option was chosen (1, 2, or 3)
  notes TEXT
);

-- Study Hall Groups
CREATE TABLE study_hall_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade_ids UUID[] NOT NULL,
  enabled BOOLEAN DEFAULT true
);
```

## Scheduling Rules (Priority Order)

### Hard Constraints (Must Be Satisfied)
1. **No Teacher Conflicts**: Teacher cannot be in two places at once
2. **No Grade Conflicts**: Grade cannot have two classes simultaneously
3. **No Duplicate Subjects Per Day**: Same subject can't appear twice on same day for same grade
4. **Fixed Slot Restrictions**: Classes with specific required time slots must be honored
5. **Teacher Availability**: Respect day/block availability restrictions
6. **Co-Taught Classes**: Same grade+subject with different teachers must be scheduled together

### Soft Constraints (Minimize Violations)
1. **No Back-to-Back OPEN**: Avoid consecutive OPEN/Study Hall blocks for full-time teachers
2. **No Same-Day Multiple OPEN**: Minimize multiple OPEN blocks on same day (not always possible)
3. **Study Hall Distribution**: Spread study halls across eligible teachers evenly

### Study Hall Rules
- Only **full-time teachers who teach 6th-11th** can supervise
- Eligible teachers: Configurable per teacher
- Teachers with **fewer teaching blocks** get assigned study halls first
- Each grade group gets exactly 1 study hall per week

## API Routes (Next.js)

All API routes handle Supabase operations. The scheduler runs client-side.

```
# Teachers
GET    /api/teachers
POST   /api/teachers
PUT    /api/teachers/[id]
DELETE /api/teachers/[id]

# Classes
GET    /api/classes?quarter_id=...
POST   /api/classes
PUT    /api/classes/[id]
DELETE /api/classes/[id]

# Rules
GET    /api/rules
PUT    /api/rules/[id]
POST   /api/rules/reorder

# Quarters
GET    /api/quarters
POST   /api/quarters
PUT    /api/quarters/[id]/activate

# History (save/load generated schedules)
GET    /api/history?quarter_id=...
POST   /api/history          # Save generation result
GET    /api/history/[id]

# Export
GET    /api/export/xlsx?generation_id=...&option=1
GET    /api/export/csv?generation_id=...&option=1
```

## Key Implementation Details

### Schedule Generation Flow (Client-Side)

1. **Load Data**: Fetch teachers, classes, restrictions from Supabase
2. **Run Solver**: Execute JavaScript backtracking solver in browser
3. **Multi-Attempt**: Run ~50 attempts with randomized slot ordering
4. **Rank Solutions**: Score by back-to-back issues + study halls placed
5. **Post-Process**: Add study halls, redistribute OPEN blocks
6. **Return Top 3**: Return best 3 unique options with stats

### JavaScript Solver Algorithm

```typescript
// Backtracking with constraint propagation
function solve(sessionIndex) {
  if (sessionIndex === sessions.length) return true; // Found solution
  
  // Get valid slots (respecting all constraints)
  const validSlots = getValidSlots(sessions[sessionIndex]);
  
  // Try slots in randomized order
  shuffle(validSlots);
  for (const slot of validSlots) {
    assign(sessionIndex, slot);
    if (solve(sessionIndex + 1)) return true;
    unassign(sessionIndex);
  }
  return false; // Backtrack
}
```

### Constraints Checked During Solving

1. **Teacher conflict**: `teacherSlots[teacher].has(slot)`
2. **Grade conflict**: `gradeSlots[grade].has(slot)`
3. **Subject/day conflict**: `gradeSubjectDays[grade|subject].has(day)`
4. **Availability**: `session.validSlots.includes(slot)`

### Export Formats

- **XLSX**: Full workbook with Summary + Option tabs (using openpyxl)
- **CSV**: One file per option, pipe-delimited for multi-value cells

## Environment Variables

### Vercel (.env.local / Vercel dashboard)
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
APP_PASSWORD=your-secure-password
```

## Development Commands

```bash
# Install dependencies
npm install

# Start dev server
npm run dev          # http://localhost:3000

# Build for production
npm run build

# Database (Supabase)
npx supabase start   # Local Supabase
npx supabase db push # Push migrations
```

## Deployment (Vercel)

```bash
# One-command deploy
vercel --prod

# Or connect GitHub repo in Vercel dashboard
```

Set environment variables in Vercel project settings.

## Common Tasks

### Adding a New Teacher
1. Navigate to /teachers
2. Click "Add Teacher"
3. Fill in name, status, study hall eligibility
4. Save

### Creating a New Quarter
1. Navigate to /quarters
2. Click "New Quarter"
3. Copy classes from previous quarter (optional)
4. Activate the quarter

### Generating a Schedule
1. Ensure active quarter has all classes configured
2. Review rules on /rules page
3. Go to /generate
4. Click "Generate Schedule"
5. Review 3 options in tabs
6. Export preferred option as XLSX/CSV

### Modifying Rules Priority
1. Go to /rules
2. Drag rules to reorder priority
3. Toggle rules on/off
4. Adjust soft constraint weights

## Code Style

- TypeScript strict mode
- Prettier for formatting
- ESLint with Next.js config
- Python: Black + isort
- Commit messages: Conventional Commits

## Testing

```bash
# Frontend
npm run test
npm run test:e2e

# Backend
pytest
```
