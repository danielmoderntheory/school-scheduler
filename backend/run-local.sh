#!/bin/bash
# Run the solver locally for development

set -e

cd "$(dirname "$0")"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install/update dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

# Run the server
echo ""
echo "Starting solver on http://localhost:8080"
if [ "$DEBUG_SOLVER" = "1" ] || [ "$DEBUG_SOLVER" = "true" ]; then
    echo "DEBUG_SOLVER is enabled - verbose logging active"
fi
echo "Press Ctrl+C to stop"
echo ""

# Pass through DEBUG_SOLVER if set
DEBUG_SOLVER=${DEBUG_SOLVER:-} python main.py
