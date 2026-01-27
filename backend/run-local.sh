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
echo "Press Ctrl+C to stop"
echo ""

python main.py
