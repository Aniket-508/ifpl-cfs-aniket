#!/bin/bash
set -e

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Pre-downloading embedding model..."
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-mpnet-base-v2')" || echo "Model download will happen at runtime"

echo "Creating index directory..."
mkdir -p /app/index

echo "Running PDF ingestion..."
if [ -d "../../data" ] && [ "$(ls -A ../../data/*.pdf 2>/dev/null)" ]; then
    echo "PDFs found, running ingestion..."
    python ingest.py --data-dir ../../data
else
    echo "No PDFs found in data directory"
fi

echo "Build complete!"
