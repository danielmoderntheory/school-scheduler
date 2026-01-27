# School Schedule Generator

## Project Overview

A web application for generating optimized K-11th grade school schedules using constraint programming. Built for Journey School to create quarterly teacher schedules that satisfy complex constraints while minimizing scheduling conflicts.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Solver**: OR-Tools CP-SAT on Google Cloud Run (primary), JS backtracking (fallback)
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Vercel (frontend) + Cloud Run (solver)
- **Auth**: Simple password protection via middleware

### Solver Architecture

**Primary: OR-Tools CP-SAT on Cloud Run**
- Python FastAPI service with Google OR-Tools
- Constraint Programming with SAT solver for optimal solutions
- ~50 seeds tried, returns top 3 unique schedules
- Post-processing: study hall assignment + back-to-back redistribution
- Auto-scales to zero when idle (free tier friendly)

**Fallback: JavaScript Backtracking (client-side)**
- Pure JS solver in `lib/scheduler.ts`
- Runs entirely in browser if Cloud Run is unavailable
- ~50 attempts with randomized backtracking
- Same post-processing logic as OR-Tools version

## Project Structure

```
school-scheduler/
├── app/
│   ├── page.tsx             # Main dashboard
│   ├── teachers/            # Teacher management
│   ├── classes/             # Class/subject management
│   ├── rules/               # Scheduling rules config
│   ├── generate/            # Schedule generation UI
│   ├── history/             # Past schedules (shareable URLs)
│   └── api/
│       ├── teachers/        # Teacher CRUD
│       ├── classes/         # Class CRUD
│       ├── history/         # Schedule history
│       ├── solve-remote/    # Proxy to Cloud Run solver
│       └── export/          # XLSX/CSV export
├── backend/                 # OR-Tools solver (deployed to Cloud Run)
│   ├── solver.py            # CP-SAT constraint solver
│   ├── main.py              # FastAPI service
│   ├── Dockerfile
│   ├── requirements.txt
│   └── deploy.sh            # Cloud Run deployment script
├── components/
│   ├── ui/                  # shadcn components
│   ├── ScheduleGrid.tsx     # Weekly schedule display
│   ├── ScheduleStats.tsx    # Stats + teacher utilization
│   └── ...
├── lib/
│   ├── supabase.ts          # Database client
│   ├── scheduler.ts         # JS backtracking solver (fallback)
│   ├── scheduler-remote.ts  # Cloud Run client
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
- Only **full-time teachers** can supervise (unless explicitly excluded via `can_supervise_study_hall = false`)
- Teachers with **fewer teaching blocks** get assigned study halls first
- Each grade (6th-11th) gets exactly 1 study hall per week
- Combinable fallback: If individual grades can't be placed, tries 6th+7th or 10th+11th combined

## API Routes (Next.js)

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

# Quarters
GET    /api/quarters
POST   /api/quarters
PUT    /api/quarters/[id]/activate

# History (auto-saved on generation for shareable URLs)
GET    /api/history?quarter_id=...
POST   /api/history
GET    /api/history/[id]

# Solver (proxy to Cloud Run)
POST   /api/solve-remote     # Proxies to Cloud Run OR-Tools solver

# Export
GET    /api/export?generation_id=...&option=1&format=xlsx
```

## Key Implementation Details

### Schedule Generation Flow

1. **Load Data**: Fetch teachers, classes, restrictions from Supabase
2. **Call Cloud Run**: POST to `/api/solve-remote` → Cloud Run OR-Tools solver
3. **CP-SAT Solving**: OR-Tools tries ~50 seeds with different random orderings
4. **Post-Process**: Add study halls, redistribute OPEN blocks (2000 iterations)
5. **Rank Solutions**: Score = `(5 - studyHallsPlaced) * 100 + backToBackIssues`
6. **Auto-Save**: Results saved to database immediately
7. **Redirect**: User sent to `/history/[id]` (shareable URL)

### OR-Tools CP-SAT Solver (backend/solver.py)

**Hard Constraints:**
- No teacher conflicts (AddAllDifferent)
- No grade conflicts (AddAllDifferent)
- No duplicate subjects per day per grade (AddDivisionEquality for day extraction)
- Fixed slot restrictions (domain limited to single slot)
- Teacher availability (domain limited to valid slots)

**Post-Processing (not modeled in CP-SAT):**
- Study hall assignment: Cycle through eligible teachers evenly
- Back-to-back redistribution: 2000-iteration swap loop to break up consecutive OPEN blocks
- Both OPEN and Study Hall count as "open" for BTB detection

### Scoring Formula

```python
score = (5 - study_halls_placed) * 100 + total_back_to_back
```

This heavily penalizes missing study halls (each missing = +100) over back-to-back issues (+1 each).

### Export Formats

- **XLSX**: Full workbook with teacher schedules
- **CSV**: Comma-separated export

## Environment Variables

### Vercel (.env.local / Vercel dashboard)
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
APP_PASSWORD=your-secure-password
SCHEDULER_API_URL=https://school-scheduler-api-xxx.us-central1.run.app
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

## Deployment

### Frontend (Vercel)

```bash
vercel --prod
```

Set environment variables in Vercel project settings.

### Solver Backend (Cloud Run)

```bash
cd backend
./deploy.sh
```

Deployment settings (free tier optimized):
- `--min-instances 0` (scales to zero when idle)
- `--max-instances 1` (prevents runaway costs)
- `--concurrency 1` (solver is CPU-bound)
- `--memory 512Mi`
- `--timeout 300`

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
2. Go to /generate
3. Click "Generate Schedule" (calls Cloud Run OR-Tools solver)
4. Wait ~1-2 minutes for solver to complete
5. Auto-redirects to /history/[id] with shareable URL
6. Review 3 options in tabs
7. Export preferred option as XLSX/CSV

### Viewing Rules
1. Go to /rules
2. Toggle rules on/off (hard constraints always enforced)

## Code Style

- TypeScript strict mode
- Prettier for formatting
- ESLint with Next.js config
- Python: Black + isort (backend)
- Commit messages: Conventional Commits
