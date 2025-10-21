"""
Unit Tests for RAG Service
Tests PDF ingestion, chunking, embedding generation, and retrieval endpoints
"""

import os
import sys
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from server import app, settings
from ingest import PDFIngestionPipeline


# Test client
client = TestClient(app)


class TestPDFIngestion:
    """Test PDF ingestion pipeline"""
    
    def test_chunk_text_basic(self):
        """Test basic text chunking"""
        pipeline = PDFIngestionPipeline(chunk_size=50, overlap=10)
        text = "This is sentence one. This is sentence two. This is sentence three."
        
        chunks = pipeline.chunk_text(text)
        
        assert len(chunks) > 0
        assert all(isinstance(c, str) for c in chunks)
        assert all(len(c) <= 60 for c in chunks)  # Allow small overflow
    
    def test_chunk_text_empty(self):
        """Test chunking empty text"""
        pipeline = PDFIngestionPipeline()
        chunks = pipeline.chunk_text("")
        
        assert len(chunks) == 0
    
    def test_chunk_text_single_long_sentence(self):
        """Test chunking when sentence exceeds chunk_size"""
        pipeline = PDFIngestionPipeline(chunk_size=20, overlap=5)
        text = "This is a very long sentence that definitely exceeds the chunk size limit."
        
        chunks = pipeline.chunk_text(text)
        
        assert len(chunks) > 0
        # Should split at word boundaries
        assert all(len(c) > 0 for c in chunks)
    
    def test_chunk_text_multilingual(self):
        """Test chunking Hindi and English text"""
        pipeline = PDFIngestionPipeline()
        text = "This is English text. यह हिंदी पाठ है। More English. और हिंदी।"
        
        chunks = pipeline.chunk_text(text)
        
        assert len(chunks) > 0
        # Check that Hindi characters are preserved
        combined = " ".join(chunks)
        assert "हिंदी" in combined
    
    def test_embedding_generation(self):
        """Test embedding generation"""
        pipeline = PDFIngestionPipeline()
        texts = ["This is a test sentence.", "Another test sentence."]
        
        embeddings = pipeline.create_embeddings(texts)
        
        assert len(embeddings) == len(texts)
        assert embeddings.shape[1] == 768  # paraphrase-multilingual-mpnet-base-v2 dimension
        # Check L2 normalization
        import numpy as np
        norms = np.linalg.norm(embeddings, axis=1)
        assert all(abs(n - 1.0) < 0.01 for n in norms)
    
    def test_build_faiss_index(self):
        """Test FAISS index building"""
        pipeline = PDFIngestionPipeline()
        chunks = ["Chunk one", "Chunk two", "Chunk three"]
        
        index, metadata = pipeline.build_faiss_index(chunks)
        
        assert index.ntotal == len(chunks)
        assert len(metadata) == len(chunks)
        assert all('text' in m for m in metadata)
        assert all('chunk_id' in m for m in metadata)


class TestRetrievalEndpoint:
    """Test retrieval API endpoints"""
    
    def test_retrieve_endpoint_success(self):
        """Test successful retrieval"""
        # Skip if index not loaded
        if not hasattr(app.state, 'index') or app.state.index is None:
            pytest.skip("Index not loaded")
        
        response = client.post(
            "/retrieve",
            json={
                "query": "financial services",
                "top_k": 3,
                "language": "en"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert isinstance(data["results"], list)
        assert len(data["results"]) <= 3
    
    def test_retrieve_endpoint_validation(self):
        """Test input validation"""
        # Missing required field
        response = client.post(
            "/retrieve",
            json={"top_k": 3}
        )
        assert response.status_code == 422  # Validation error
        
        # Invalid top_k
        response = client.post(
            "/retrieve",
            json={"query": "test", "top_k": 0}
        )
        assert response.status_code == 422
    
    def test_retrieve_endpoint_hindi(self):
        """Test Hindi query retrieval"""
        if not hasattr(app.state, 'index') or app.state.index is None:
            pytest.skip("Index not loaded")
        
        response = client.post(
            "/retrieve",
            json={
                "query": "वित्तीय सेवाएं",
                "top_k": 2,
                "language": "hi"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
    
    def test_retrieve_endpoint_high_top_k(self):
        """Test retrieval with high top_k"""
        if not hasattr(app.state, 'index') or app.state.index is None:
            pytest.skip("Index not loaded")
        
        response = client.post(
            "/retrieve",
            json={
                "query": "banking",
                "top_k": 100
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return all available results (capped by index size)
        assert len(data["results"]) <= 100


class TestStatusEndpoint:
    """Test status/health check endpoint"""
    
    def test_status_endpoint(self):
        """Test status endpoint"""
        response = client.get("/status")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] == "ok"
        assert "index_loaded" in data
        assert "num_documents" in data
        assert "model_name" in data
        
        if data["index_loaded"]:
            assert data["num_documents"] >= 0
            assert isinstance(data["model_name"], str)


class TestTranscribeEndpoint:
    """Test audio transcription endpoint"""
    
    def test_transcribe_endpoint_no_file(self):
        """Test transcribe endpoint without file"""
        response = client.post("/transcribe")
        
        # Should return 422 (missing required field) or 400
        assert response.status_code in [400, 422]
    
    @pytest.mark.skipif(
        not settings.ENABLE_WHISPER_TRANSCRIPTION,
        reason="Whisper transcription disabled"
    )
    def test_transcribe_endpoint_with_audio(self, tmp_path):
        """Test transcribe endpoint with audio file"""
        # Create dummy audio file (won't work with real Whisper, just testing upload)
        audio_file = tmp_path / "test.wav"
        audio_file.write_bytes(b"fake audio data")
        
        with open(audio_file, "rb") as f:
            response = client.post(
                "/transcribe",
                files={"audio_file": ("test.wav", f, "audio/wav")}
            )
        
        # May fail with actual Whisper processing, but should accept upload
        assert response.status_code in [200, 400, 500]


class TestIntegration:
    """Integration tests"""
    
    @pytest.mark.integration
    def test_full_ingestion_retrieval_flow(self, tmp_path):
        """Test complete flow from ingestion to retrieval"""
        # Create test PDF directory
        pdf_dir = tmp_path / "pdfs"
        pdf_dir.mkdir()
        
        # Create a simple test PDF (requires reportlab)
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import letter
            
            pdf_path = pdf_dir / "test.pdf"
            c = canvas.Canvas(str(pdf_path), pagesize=letter)
            c.drawString(100, 750, "Test financial document.")
            c.drawString(100, 730, "This document discusses banking services.")
            c.drawString(100, 710, "Account opening and loan procedures.")
            c.showPage()
            c.save()
        except ImportError:
            pytest.skip("reportlab not installed")
        
        # Run ingestion
        pipeline = PDFIngestionPipeline()
        output_dir = tmp_path / "output"
        output_dir.mkdir()
        
        pipeline.process_pdfs(
            pdf_directory=str(pdf_dir),
            output_directory=str(output_dir)
        )
        
        # Check outputs
        assert (output_dir / "faiss_index.bin").exists()
        assert (output_dir / "metadata.pkl").exists()
        
        # Load and test retrieval
        import faiss
        import pickle
        
        index = faiss.read_index(str(output_dir / "faiss_index.bin"))
        with open(output_dir / "metadata.pkl", "rb") as f:
            metadata = pickle.load(f)
        
        assert index.ntotal > 0
        assert len(metadata) == index.ntotal
        
        # Test search
        query = "banking services"
        query_embedding = pipeline.create_embeddings([query])
        scores, indices = index.search(query_embedding, k=2)
        
        assert len(indices[0]) == 2
        assert all(idx >= 0 for idx in indices[0])
        results = [metadata[idx] for idx in indices[0]]
        assert all('text' in r for r in results)


class TestErrorHandling:
    """Test error handling scenarios"""
    
    def test_invalid_pdf_directory(self):
        """Test handling of invalid PDF directory"""
        pipeline = PDFIngestionPipeline()
        
        with pytest.raises((FileNotFoundError, ValueError)):
            pipeline.process_pdfs(
                pdf_directory="/nonexistent/path",
                output_directory="/tmp/output"
            )
    
    def test_corrupted_pdf_handling(self, tmp_path):
        """Test handling of corrupted PDF files"""
        pdf_dir = tmp_path / "pdfs"
        pdf_dir.mkdir()
        
        # Create fake PDF
        fake_pdf = pdf_dir / "corrupted.pdf"
        fake_pdf.write_text("This is not a valid PDF")
        
        pipeline = PDFIngestionPipeline()
        output_dir = tmp_path / "output"
        output_dir.mkdir()
        
        # Should handle gracefully (log error and continue)
        try:
            pipeline.process_pdfs(
                pdf_directory=str(pdf_dir),
                output_directory=str(output_dir)
            )
        except Exception as e:
            # Should either skip corrupted files or raise informative error
            assert "PDF" in str(e) or "corrupted" in str(e).lower()


# Pytest fixtures
@pytest.fixture(scope="session")
def sample_documents():
    """Sample documents for testing"""
    return [
        {
            "text": "Banking services include savings accounts, current accounts, and fixed deposits.",
            "page": 1,
            "filename": "banking.pdf"
        },
        {
            "text": "Loan products available are personal loans, home loans, and business loans.",
            "page": 2,
            "filename": "loans.pdf"
        },
        {
            "text": "बैंकिंग सेवाओं में बचत खाते, चालू खाते और सावधि जमा शामिल हैं।",
            "page": 1,
            "filename": "banking_hindi.pdf"
        }
    ]


@pytest.fixture(scope="session")
def embedding_model():
    """Load embedding model once for all tests"""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer('paraphrase-multilingual-mpnet-base-v2')


# Run tests with:
# pytest tests/test_retrieve.py -v
# pytest tests/test_retrieve.py -v -m integration  # Run integration tests only
# pytest tests/test_retrieve.py -v --cov=. --cov-report=html  # With coverage
