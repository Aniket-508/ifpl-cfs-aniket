#!/bin/bash
set -e

echo "Installing dependencies..."
npm install

# Install ffmpeg (for audio processing)
echo "Installing system dependencies..."
apt-get update && apt-get install -y ffmpeg || echo "ffmpeg install failed (may need Docker)"

echo "Creating required directories..."
mkdir -p uploads audio

echo "Build complete!"
