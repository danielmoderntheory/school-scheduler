#!/bin/bash

# Deploy School Scheduler API to Google Cloud Run
#
# Prerequisites:
#   1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
#   2. Authenticate: gcloud auth login
#
# Usage: ./deploy.sh

set -e

# Configuration
PROJECT_ID="school-scheduler-solver"
SERVICE_NAME="school-scheduler-api"
REGION="us-central1"

# Set the project
echo "Setting Google Cloud project to: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Free tier optimized settings
MEMORY="512Mi"          # Start small; use 1Gi only if solver fails
CPU="1"                 # Single CPU
TIMEOUT="300"           # 5 min max
MIN_INSTANCES="0"       # CRITICAL: scales to zero when idle
MAX_INSTANCES="1"       # Prevents parallel runaway costs
CONCURRENCY="1"         # One request at a time (solver is CPU-bound)

echo "=== Deploying School Scheduler API to Cloud Run ==="
echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo "Memory: $MEMORY, CPU: $CPU, Concurrency: $CONCURRENCY"
echo ""

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --memory $MEMORY \
  --cpu $CPU \
  --timeout $TIMEOUT \
  --min-instances $MIN_INSTANCES \
  --max-instances $MAX_INSTANCES \
  --concurrency $CONCURRENCY \
  --set-env-vars "FRONTEND_URL=https://school-scheduler.vercel.app"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Your API is now available at:"
gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)'
echo ""
echo "Next steps:"
echo "1. Copy the URL above"
echo "2. Add SCHEDULER_API_URL to your Vercel environment variables"
echo "3. Redeploy your frontend"
