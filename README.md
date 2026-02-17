# School Schedule Generator

A web application for generating optimized K-11th grade school schedules using constraint programming.

## Features

- **Teacher & Class Management**: Easy UI to add/edit teachers, classes, and scheduling restrictions
- **Constraint-Based Optimization**: Uses Google OR-Tools CP-SAT solver to find optimal schedules
- **Multiple Options**: Generates 3 schedule options ranked by quality
- **Study Hall Assignment**: Automatically assigns study halls to eligible teachers
- **Export**: Download schedules as XLSX or CSV
- **History**: Track and compare past schedule generations
- **Quarter-Based**: Organize schedules by academic quarter

## Tech Stack

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Backend**: Python FastAPI + OR-Tools (Cloud Run)
- **Database**: Neon (Serverless PostgreSQL)
- **Hosting**: Vercel (frontend) + Google Cloud Run (solver)

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- Neon account (free tier)

### Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo>
   cd school-scheduler
   ```

2. **Set up the database**
   ```bash
   # Create a Neon project at https://neon.tech
   # Run schema.sql against your database
   psql $NEON_DATABASE_URL -f schema.sql
   ```

3. **Start the backend** (optional - for local solver)
   ```bash
   cd backend
   ./run-local.sh
   ```

4. **Start the frontend**
   ```bash
   npm install

   # Create .env.local from .env.example
   cp .env.example .env.local
   # Edit .env.local with your Neon connection string

   npm run dev
   ```

5. **Open http://localhost:3000**

## Deployment

### Backend (Cloud Run)

```bash
cd backend
./deploy.sh
```

### Frontend (Vercel)

1. Import your GitHub repo to Vercel
2. Add environment variables:
   - `NEON_DATABASE_URL`: Your Neon connection string
   - `SCHEDULER_API_URL`: Your Cloud Run backend URL
   - `APP_PASSWORD`

## Project Structure

```
school-scheduler/
├── app/                # Next.js app router pages
├── components/         # React components
├── lib/               # Shared utilities
├── backend/           # FastAPI + OR-Tools solver
├── schema.sql         # Database schema
├── CLAUDE.md          # AI assistant context
└── README.md
```

## Scheduling Rules

### Hard Constraints (always enforced)
1. No teacher conflicts
2. No grade conflicts
3. No duplicate subjects per day
4. Fixed slot restrictions
5. Teacher availability
6. Co-taught classes

### Soft Constraints (minimized)
1. No back-to-back OPEN blocks
2. Spread OPEN blocks across days
3. Even study hall distribution

## License

MIT
