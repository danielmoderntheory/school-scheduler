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
- **Backend**: Python FastAPI + OR-Tools
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Vercel (frontend) + Railway (backend)

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- Supabase account (free tier)
- Railway account (free tier)

### Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo>
   cd school-scheduler
   ```

2. **Set up the database**
   ```bash
   # Create a new Supabase project
   # Run the migration in supabase/migrations/001_initial_schema.sql
   ```

3. **Start the backend**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   
   # Create .env file
   echo "CORS_ORIGINS=http://localhost:3000" > .env
   
   uvicorn main:app --reload
   ```

4. **Start the frontend**
   ```bash
   cd frontend
   npm install
   
   # Create .env.local file
   cat > .env.local << EOF
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-key
   SCHEDULER_API_URL=http://localhost:8000
   APP_PASSWORD=your-password
   EOF
   
   npm run dev
   ```

5. **Open http://localhost:3000**

## Deployment

### Backend (Railway)

1. Create a new Railway project
2. Connect your GitHub repo
3. Set root directory to `/backend`
4. Add environment variables:
   - `CORS_ORIGINS`: Your Vercel frontend URL

### Frontend (Vercel)

1. Import your GitHub repo to Vercel
2. Set root directory to `/frontend`
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SCHEDULER_API_URL`: Your Railway backend URL
   - `APP_PASSWORD`

## Project Structure

```
school-scheduler/
├── frontend/           # Next.js app
├── backend/            # FastAPI + OR-Tools
├── supabase/          # Database migrations
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
