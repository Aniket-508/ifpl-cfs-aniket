#!/usr/bin/env python3
"""
FastAPI RAG Retrieval Server for Shankh.ai

Provides semantic search endpoints for querying the vector database.
Loads FAISS index and metadata on startup for fast retrieval.

Endpoints:
    POST /retrieve - Semantic search with query text
    GET /status - Health check and service info
    POST /transcribe - (Optional) Whisper STT endpoint

Example curl:
    curl -X POST http://localhost:8000/retrieve \
      -H "Content-Type: application/json" \
      -d '{"query": "loan eligibility criteria", "k": 5}'

Author: Shankh.ai Team
"""

import os
import pickle
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime

import numpy as np
import faiss
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

# Optional: Whisper for local STT
try:
    import whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False

# Optional: Language detection
try:
    from langdetect import detect, LangDetectException
    LANGDETECT_AVAILABLE = True
except ImportError:
    LANGDETECT_AVAILABLE = False

# Stock service
try:
    from stock_service import StockPriceService
    STOCK_SERVICE_AVAILABLE = True
except ImportError:
    STOCK_SERVICE_AVAILABLE = False
    print("Warning: stock_service not available. Install yfinance to enable stock features.")

# Load environment variables
load_dotenv()


# Configuration
class Settings(BaseSettings):
    """Server configuration from environment variables"""
    embedding_model: str = Field(
        default="paraphrase-multilingual-mpnet-base-v2",
        env="EMBEDDING_MODEL"
    )
    index_path: str = Field(default="./index", env="INDEX_PATH")
    whisper_model: str = Field(default="base", env="WHISPER_MODEL")
    host: str = Field(default="0.0.0.0", env="HOST")
    port: int = Field(default=8000, env="PORT")
    
    class Config:
        env_file = ".env"


settings = Settings()


# Request/Response Models
class RetrievalRequest(BaseModel):
    """Request schema for /retrieve endpoint"""
    query: str = Field(..., description="Search query text", min_length=1)
    k: int = Field(default=5, description="Number of results to return", ge=1, le=50)
    lang_hint: Optional[str] = Field(
        default=None, 
        description="Optional language hint (e.g., 'en', 'hi')"
    )
    threshold: Optional[float] = Field(
        default=None,
        description="Minimum similarity score threshold (0-1)",
        ge=0.0,
        le=1.0
    )


class DocumentResult(BaseModel):
    """Single document result with metadata"""
    chunk_id: int
    filename: str
    page_num: int
    text: str
    excerpt: str
    score: float = Field(description="Similarity score (higher = more relevant)")
    char_start: int
    char_end: int


class RetrievalResponse(BaseModel):
    """Response schema for /retrieve endpoint"""
    query: str
    results: List[DocumentResult]
    num_results: int
    detected_language: Optional[str] = None
    processing_time_ms: float


class StatusResponse(BaseModel):
    """Response schema for /status endpoint"""
    status: str
    service: str
    version: str
    embedding_model: str
    index_loaded: bool
    num_chunks: int
    whisper_available: bool
    langdetect_available: bool
    uptime_seconds: float


class TranscriptionResponse(BaseModel):
    """Response schema for /transcribe endpoint (Whisper)"""
    text: str
    language: str
    confidence: Optional[float] = None
    segments: List[Dict[str, Any]] = []


# Global state
class ServerState:
    """Global server state"""
    def __init__(self):
        self.index: Optional[faiss.Index] = None
        self.metadata: Optional[Dict] = None
        self.model: Optional[SentenceTransformer] = None
        self.whisper_model: Optional[Any] = None
        self.start_time: datetime = datetime.now()
        self.ready: bool = False


state = ServerState()


# FastAPI app
app = FastAPI(
    title="Shankh.ai RAG Service",
    description="Semantic search and retrieval service for financial documents",
    version="1.0.0"
)

# CORS middleware (configure for production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_index_and_metadata():
    """Load FAISS index and metadata on startup"""
    index_dir = Path(settings.index_path)
    
    if not index_dir.exists():
        raise RuntimeError(
            f"Index directory not found: {index_dir}\n"
            f"Run 'python ingest.py' first to create the index."
        )
    
    # Load FAISS index
    index_file = index_dir / "faiss_index.bin"
    if not index_file.exists():
        raise RuntimeError(f"FAISS index file not found: {index_file}")
    
    print(f"Loading FAISS index from {index_file}...")
    state.index = faiss.read_index(str(index_file))
    print(f"✓ Loaded index with {state.index.ntotal} vectors")
    
    # Load metadata
    metadata_file = index_dir / "metadata.pkl"
    if not metadata_file.exists():
        raise RuntimeError(f"Metadata file not found: {metadata_file}")
    
    print(f"Loading metadata from {metadata_file}...")
    with open(metadata_file, 'rb') as f:
        state.metadata = pickle.load(f)
    print(f"✓ Loaded metadata for {len(state.metadata['chunks'])} chunks")
    
    # Verify embedding model matches
    stored_model = state.metadata.get('embedding_model')
    if stored_model and stored_model != settings.embedding_model:
        print(f"Warning: Index was built with {stored_model}, "
              f"but configured to use {settings.embedding_model}")


def load_embedding_model():
    """Load sentence transformer model"""
    print(f"Loading embedding model: {settings.embedding_model}...")
    # Use token=False to avoid authentication issues with public models
    state.model = SentenceTransformer(settings.embedding_model, token=False)
    print(f"✓ Model loaded (dim: {state.model.get_sentence_embedding_dimension()})")


def load_whisper_model():
    """Load Whisper model for STT (optional)"""
    if not WHISPER_AVAILABLE:
        print("Whisper not available - STT endpoint will be disabled")
        return
    
    try:
        print(f"Loading Whisper model: {settings.whisper_model}...")
        state.whisper_model = whisper.load_model(settings.whisper_model)
        print(f"✓ Whisper model loaded")
    except Exception as e:
        print(f"Warning: Could not load Whisper model: {e}")


@app.on_event("startup")
async def startup_event():
    """Initialize service on startup"""
    print("=" * 70)
    print("  Shankh.ai RAG Service Starting...")
    print("=" * 70)
    
    try:
        load_embedding_model()
        load_index_and_metadata()
        load_whisper_model()
        
        state.ready = True
        print("=" * 70)
        print("  ✓ RAG Service Ready!")
        print("=" * 70)
        
    except Exception as e:
        print(f"✗ Startup failed: {e}")
        import traceback
        traceback.print_exc()
        raise


@app.get("/", response_model=Dict[str, str])
async def root():
    """Root endpoint"""
    return {
        "service": "Shankh.ai RAG Service",
        "status": "running" if state.ready else "initializing",
        "docs": "/docs"
    }


@app.get("/status", response_model=StatusResponse)
async def get_status():
    """
    Health check and service status
    
    Returns information about the service, loaded index, and capabilities.
    """
    uptime = (datetime.now() - state.start_time).total_seconds()
    
    return StatusResponse(
        status="ready" if state.ready else "initializing",
        service="RAG Retrieval Service",
        version="1.0.0",
        embedding_model=settings.embedding_model,
        index_loaded=state.index is not None,
        num_chunks=len(state.metadata['chunks']) if state.metadata else 0,
        whisper_available=WHISPER_AVAILABLE and state.whisper_model is not None,
        langdetect_available=LANGDETECT_AVAILABLE,
        uptime_seconds=uptime
    )


@app.post("/retrieve", response_model=RetrievalResponse)
async def retrieve(request: RetrievalRequest):
    """
    Semantic search endpoint
    
    Performs vector similarity search and returns top-k most relevant document chunks.
    
    Args:
        request: RetrievalRequest with query text and parameters
        
    Returns:
        RetrievalResponse with ranked results and metadata
        
    Example:
        ```bash
        curl -X POST http://localhost:8000/retrieve \
          -H "Content-Type: application/json" \
          -d '{"query": "What are the loan eligibility criteria?", "k": 5}'
        ```
    """
    if not state.ready:
        raise HTTPException(status_code=503, detail="Service not ready")
    
    start_time = datetime.now()
    
    # Detect language (optional)
    detected_lang = None
    if LANGDETECT_AVAILABLE:
        try:
            detected_lang = detect(request.query)
        except LangDetectException:
            pass
    
    # Generate query embedding
    query_embedding = state.model.encode([request.query], convert_to_numpy=True)
    
    # Normalize for cosine similarity
    faiss.normalize_L2(query_embedding)
    
    # Search index
    distances, indices = state.index.search(query_embedding, request.k)
    
    # Build results
    results = []
    for idx, (distance, chunk_idx) in enumerate(zip(distances[0], indices[0])):
        if chunk_idx == -1:  # FAISS returns -1 for missing results
            continue
            
        chunk_data = state.metadata['chunks'][chunk_idx]
        score = float(distance)  # Cosine similarity (higher = better)
        
        # Apply threshold filter if specified
        if request.threshold is not None and score < request.threshold:
            continue
        
        result = DocumentResult(
            chunk_id=chunk_data['chunk_id'],
            filename=chunk_data['filename'],
            page_num=chunk_data['page_num'],
            text=chunk_data['text'],
            excerpt=chunk_data['excerpt'],
            score=score,
            char_start=chunk_data['char_start'],
            char_end=chunk_data['char_end']
        )
        results.append(result)
    
    # Calculate processing time
    processing_time = (datetime.now() - start_time).total_seconds() * 1000
    
    return RetrievalResponse(
        query=request.query,
        results=results,
        num_results=len(results),
        detected_language=detected_lang,
        processing_time_ms=round(processing_time, 2)
    )


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(audio: UploadFile = File(...)):
    """
    Transcribe audio using Whisper (optional endpoint)
    
    Accepts audio file and returns transcription with language detection.
    
    Args:
        audio: Audio file (wav, mp3, etc.)
        
    Returns:
        TranscriptionResponse with text and metadata
        
    Example:
        ```bash
        curl -X POST http://localhost:8000/transcribe \
          -F "audio=@recording.wav"
        ```
    """
    if not WHISPER_AVAILABLE or state.whisper_model is None:
        raise HTTPException(
            status_code=501,
            detail="Whisper STT not available. Install with: pip install openai-whisper"
        )
    
    try:
        # Save uploaded file temporarily
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            content = await audio.read()
            temp_file.write(content)
            temp_path = temp_file.name
        
        # Transcribe with Whisper
        result = state.whisper_model.transcribe(temp_path)
        
        # Clean up temp file
        os.unlink(temp_path)
        
        # Calculate average confidence from segments
        segments = result.get('segments', [])
        avg_confidence = None
        if segments:
            confidences = [seg.get('no_speech_prob', 0) for seg in segments]
            avg_confidence = 1.0 - (sum(confidences) / len(confidences))
        
        return TranscriptionResponse(
            text=result['text'].strip(),
            language=result.get('language', 'unknown'),
            confidence=avg_confidence,
            segments=[
                {
                    'start': seg['start'],
                    'end': seg['end'],
                    'text': seg['text'].strip()
                }
                for seg in segments
            ]
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


@app.get("/health")
async def health():
    """Simple health check"""
    return {"status": "healthy", "ready": state.ready}


if __name__ == "__main__":
    import uvicorn
    
    print(f"Starting server on {settings.host}:{settings.port}")
    uvicorn.run(
        "server:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info"
    )


# =============================================================================
# Stock Price Endpoints (yfinance integration)
# =============================================================================

if STOCK_SERVICE_AVAILABLE:
    stock_service = StockPriceService()
    
    class StockPriceRequest(BaseModel):
        """Request schema for stock price endpoint"""
        symbol: str = Field(..., description="Stock symbol (e.g., RELIANCE, TCS, INFY)")
    
    class MultipleStocksRequest(BaseModel):
        """Request schema for multiple stocks"""
        symbols: List[str] = Field(..., description="List of stock symbols")
    
    class StockSearchRequest(BaseModel):
        """Request schema for stock search"""
        query: str = Field(..., description="Search query (company name or symbol)")
    
    @app.post("/stock/price")
    async def get_stock_price(request: StockPriceRequest):
        """Get current stock price for Indian market"""
        data = stock_service.get_stock_price(request.symbol)
        if not data:
            raise HTTPException(status_code=404, detail=f"Stock not found: {request.symbol}")
        return data
    
    @app.post("/stock/multiple")
    async def get_multiple_stocks(request: MultipleStocksRequest):
        """Get prices for multiple stocks"""
        return stock_service.get_multiple_stocks(request.symbols)
    
    @app.post("/stock/search")
    async def search_stocks(request: StockSearchRequest):
        """Search for stocks by name or symbol"""
        return {"results": stock_service.search_stock(request.query)}
    
    @app.get("/stock/indices")
    async def get_indian_indices():
        """Get major Indian market indices"""
        indices = ['NIFTY', 'SENSEX', 'BANKNIFTY']
        return stock_service.get_multiple_stocks(indices)


# Unit test examples:
"""
import pytest
from fastapi.testclient import TestClient

def test_status_endpoint():
    '''Test status endpoint returns correct info'''
    client = TestClient(app)
    response = client.get("/status")
    assert response.status_code == 200
    data = response.json()
    assert data['service'] == "RAG Retrieval Service"
    assert 'num_chunks' in data

def test_retrieve_endpoint():
    '''Test retrieval with sample query'''
    client = TestClient(app)
    response = client.post(
        "/retrieve",
        json={"query": "loan eligibility", "k": 3}
    )
    assert response.status_code == 200
    data = response.json()
    assert 'results' in data
    assert data['num_results'] <= 3
    assert len(data['results']) <= 3
    
    # Check result structure
    if data['results']:
        result = data['results'][0]
        assert 'filename' in result
        assert 'page_num' in result
        assert 'text' in result
        assert 'score' in result

def test_retrieve_with_threshold():
    '''Test retrieval with similarity threshold'''
    client = TestClient(app)
    response = client.post(
        "/retrieve",
        json={"query": "interest rate", "k": 10, "threshold": 0.5}
    )
    assert response.status_code == 200
    data = response.json()
    
    # All results should meet threshold
    for result in data['results']:
        assert result['score'] >= 0.5
"""
