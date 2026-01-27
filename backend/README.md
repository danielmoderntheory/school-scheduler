# School Scheduler - OR-Tools Backend

Python OR-Tools CP-SAT solver for school schedule generation, designed to run on Google Cloud Run.

## Features

- **CP-SAT Solver**: Uses Google OR-Tools Constraint Programming with SAT solver
- **Multiple Seeds**: Runs up to 150 different seeds to find variety in solutions
- **Ranked Results**: Returns top 3 solutions ranked by quality (fewer conflicts)
- **Graceful Timeout**: Returns best solution found if time limit approaches

## Local Development

### Prerequisites

- Python 3.11+
- pip

### Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run locally
python main.py
```

The API will be available at http://localhost:8080

### Test the API

```bash
# Health check
curl http://localhost:8080/health

# Solve (example)
curl -X POST http://localhost:8080/solve \
  -H "Content-Type: application/json" \
  -d '{
    "teachers": [
      {"name": "Teacher A", "status": "full-time"},
      {"name": "Teacher B", "status": "full-time"}
    ],
    "classes": [
      {"teacher": "Teacher A", "grade": "6th Grade", "subject": "Math", "daysPerWeek": 3},
      {"teacher": "Teacher B", "grade": "6th Grade", "subject": "English", "daysPerWeek": 3}
    ],
    "numOptions": 3,
    "numAttempts": 50
  }'
```

## Deploy to Google Cloud Run

### Prerequisites

1. [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed
2. A Google Cloud project with billing enabled
3. Cloud Run API enabled

### Deploy

```bash
# Login to Google Cloud
gcloud auth login

# Deploy
./deploy.sh
```

The script will:
1. Build the Docker image
2. Push to Google Container Registry
3. Deploy to Cloud Run
4. Output the service URL

### After Deployment

1. Copy the Cloud Run URL (e.g., `https://school-scheduler-api-xxxxx-uc.a.run.app`)
2. Add to Vercel environment variables:
   - Name: `SCHEDULER_API_URL`
   - Value: Your Cloud Run URL
3. Redeploy your Vercel frontend

## API Endpoints

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1706123456.789
}
```

### `POST /solve`

Generate schedule options.

**Request Body:**
```json
{
  "teachers": [
    {
      "name": "Teacher Name",
      "status": "full-time",
      "canSuperviseStudyHall": true
    }
  ],
  "classes": [
    {
      "teacher": "Teacher Name",
      "grade": "6th Grade",
      "subject": "Math",
      "daysPerWeek": 3,
      "availableDays": ["Mon", "Tues", "Wed", "Thurs", "Fri"],
      "availableBlocks": [1, 2, 3, 4, 5],
      "fixedSlots": [["Mon", 1]]
    }
  ],
  "numOptions": 3,
  "numAttempts": 150,
  "maxTimeSeconds": 280
}
```

**Response:**
```json
{
  "status": "success",
  "options": [...],
  "message": "Found 3 options from 45 solutions (150 seeds in 120.5s)",
  "seedsCompleted": 150,
  "infeasibleCount": 105,
  "elapsedSeconds": 120.5
}
```

## Constraints

### Hard Constraints (must be satisfied)

1. **No teacher conflicts**: A teacher can only be in one place at a time
2. **No grade conflicts**: A grade can only have one class at a time
3. **No duplicate subjects per day**: Same grade can't have same subject twice on one day
4. **Fixed slots honored**: Classes with fixed time slots are placed there

### Soft Constraints (minimized)

1. **Back-to-back OPEN blocks**: Minimized for full-time teachers
2. **Study hall distribution**: Spread evenly among eligible teachers

## Cost Estimates

Cloud Run pricing (as of 2024):
- First 2 million requests/month: Free
- CPU: $0.00002400 per vCPU-second
- Memory: $0.00000250 per GiB-second

Typical solve request (2 minutes, 1 vCPU, 1GB RAM):
- ~$0.003 per request
- 1000 requests/month ≈ $3
