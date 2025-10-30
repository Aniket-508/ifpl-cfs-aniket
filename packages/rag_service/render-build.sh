#!/bin/bash
set -e

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Pre-downloading embedding model..."
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-mpnet-base-v2')" || echo "Model download will happen at runtime"

echo "Creating index directory..."
mkdir -p /app/index

echo "Running PDF ingestion..."
if [ -d "../../data/pdfs" ]; then
    PDF_COUNT=$(find ../../data/pdfs -name "*.pdf" | wc -l)
    echo "Found $PDF_COUNT PDF files in data/pdfs directory"
    
    if [ "$PDF_COUNT" -gt 0 ]; then
        echo "PDFs found, running ingestion..."
        python ingest.py --data-dir ../../data/pdfs
    else
        echo "No PDFs found in data/pdfs directory"
    fi
else
    echo "No PDFs found in data directory"
fi

echo "Build complete!"
