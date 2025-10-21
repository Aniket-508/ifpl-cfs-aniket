# Shankh.ai - Multilingual Financial Chatbot

**Shankh.ai** is a production-ready, multilingual conversational AI chatbot designed for financial assistance with RAG (Retrieval-Augmented Generation), supporting Indian languages including Hindi. The system uses local models where possible to minimize costs and maximize privacy.

---

## 📋 Overview

### Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Frontend      │         │   Backend        │         │   RAG Service   │
│  React + Vite   │◄───────►│  Node.js/Express │◄───────►│  Python/FastAPI │
│  Web Audio API  │         │  Socket.IO       │         │  FAISS + S-BERT │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │  LLM Providers   │
                            │  Claude Sonnet   │
                            │  OpenRouter      │
                            │  Gemini/DeepSeek │
                            └──────────────────┘
```

### Key Features

- **🎤 Multilingual Speech-to-Text**: Whisper-based transcription with language detection, confidence thresholds, and support for Indian languages
- **🔊 Text-to-Speech**: gTTS with automatic chunking to bypass 1000-char limits, audio concatenation via ffmpeg
- **📚 RAG Pipeline**: Vector search over financial PDFs using multilingual embeddings (sentence-transformers) + FAISS
- **🤖 LLM Orchestration**: Configurable adapter supporting Claude Sonnet, OpenRouter, Gemini, DeepSeek with fallback logic
- **💬 Session Memory**: In-memory conversation history with optional Redis persistence
- **🌍 Language Switching**: Auto-detect user language (English/Hindi) with explicit toggle support
- **📖 Source Citations**: All fact-based answers include RAG citations with filename, page number, and excerpts
- **🛡️ Safety Guardrails**: Hallucination mitigation by requiring sources for factual claims

---

## 🚀 Quickstart

### Prerequisites

- **Node.js** 18+ (for backend + frontend)
- **Python** 3.9+ (for RAG service)
- **ffmpeg** (for audio processing)
- **Docker** (optional, for containerized deployment)

### Local Setup (Recommended for Development)

#### 1. Clone and Install

```bash
# Clone the repository
cd shankh-ai

# Install backend dependencies
cd packages/backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Install RAG service dependencies
cd ../rag_service
pip install -r requirements.txt
```

#### 2. Configure Environment Variables

Copy the example env files and fill in your API keys:

```bash
# Root level
cp .env.example .env

# Backend
cp packages/backend/.env.example packages/backend/.env

# RAG Service
cp packages/rag_service/.env.example packages/rag_service/.env
```

**Required Environment Variables:**

| Variable             | Description                   | Example                                 |
| -------------------- | ----------------------------- | --------------------------------------- |
| `CLAUDE_API_KEY`     | Anthropic Claude API key      | `sk-ant-...`                            |
| `OPENROUTER_API_KEY` | OpenRouter API key (fallback) | `sk-or-...`                             |
| `RAG_SERVICE_URL`    | RAG service endpoint          | `http://localhost:8000`                 |
| `REDIS_URL`          | Redis connection (optional)   | `redis://localhost:6379`                |
| `TTS_PROVIDER`       | TTS engine                    | `gtts` (default)                        |
| `EMBEDDING_MODEL`    | Sentence transformer model    | `paraphrase-multilingual-mpnet-base-v2` |

#### 3. Ingest PDFs into Vector Database

```bash
cd packages/rag_service

# Run ingestion script
python ingest.py --data-dir ../../data

# This will:
# - Load 151.pdf and 149[1].pdf
# - Extract and chunk text (~500-800 chars per chunk)
# - Generate multilingual embeddings
# - Build FAISS index and save to ./index/
```

#### 4. Start Services

**Terminal 1 - RAG Service:**

```bash
cd packages/rag_service
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Backend:**

```bash
cd packages/backend
npm run dev
```

**Terminal 3 - Frontend:**

```bash
cd packages/frontend
npm run dev
```

Open browser at `http://localhost:5173` 🎉

---

### 🐳 Docker Setup

For production or simplified local testing:

```bash
# Start all services
docker-compose -f infra/docker-compose.yml up --build

# Services will be available at:
# - Frontend: http://localhost:3000
# - Backend: http://localhost:4000
# - RAG Service: http://localhost:8000
```

---

## 📖 Usage Guide

### Testing RAG Queries

```bash
# Query the RAG service directly
curl -X POST http://localhost:8000/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the loan eligibility criteria?",
    "k": 5,
    "lang_hint": "en"
  }'

# Response includes:
# - Top k document chunks with metadata
# - Similarity scores
# - Filename, page number, excerpt
```

### Testing TTS

```bash
# Send a chat message via backend
curl -X POST http://localhost:4000/chat/sendText \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-123",
    "text": "Tell me about fixed deposits",
    "language": "en"
  }'

# Response includes:
# - text: LLM response
# - html_formatted: Markdown-rendered HTML
# - language: Detected/specified language
# - rag_sources: Array of citations
# - tts_audio_url: URL to generated audio file
# - llm_provider: Which LLM was used
```

### Testing Audio Upload (STT)

```bash
# Upload audio file for transcription
curl -X POST http://localhost:4000/chat/sendAudio \
  -F "audio=@recording.wav" \
  -F "sessionId=test-session-123"

# Backend will:
# 1. Transcribe audio (Whisper)
# 2. Detect language + confidence
# 3. Retrieve relevant RAG documents
# 4. Generate LLM response with citations
# 5. Synthesize TTS audio
# 6. Return complete JSON response
```

---

## 🏗️ Project Structure

```
shankh-ai/
├─ packages/
│  ├─ frontend/              # React + Vite UI
│  │  ├─ src/
│  │  │  ├─ App.jsx          # Main app component
│  │  │  ├─ components/
│  │  │  │  └─ Chat.jsx      # Chat interface
│  │  │  └─ utils/
│  │  │     └─ audioRecorder.js
│  │  ├─ package.json
│  │  └─ vite.config.js
│  │
│  ├─ backend/               # Node.js Express API
│  │  ├─ server.js           # Main Express server
│  │  ├─ llmAdapter.js       # LLM provider abstraction
│  │  ├─ sttService.js       # Speech-to-text
│  │  ├─ ttsService.js       # Text-to-speech
│  │  ├─ package.json
│  │  └─ .env.example
│  │
│  └─ rag_service/           # Python FastAPI RAG
│     ├─ server.py           # FastAPI server
│     ├─ ingest.py           # PDF ingestion script
│     ├─ requirements.txt
│     ├─ tests/
│     │  └─ test_retrieve.py
│     └─ .env.example
│
├─ data/                     # Source PDFs
│  ├─ 151.pdf
│  └─ 149[1].pdf
│
├─ infra/
│  └─ docker-compose.yml
│
├─ .env.example
└─ README.md
```

---

## 🔧 Configuration Details

### RAG Service Configuration

| Variable          | Default                                 | Description                |
| ----------------- | --------------------------------------- | -------------------------- |
| `EMBEDDING_MODEL` | `paraphrase-multilingual-mpnet-base-v2` | Sentence transformer model |
| `INDEX_PATH`      | `./index`                               | Directory for FAISS index  |
| `CHUNK_SIZE`      | `700`                                   | Characters per text chunk  |
| `CHUNK_OVERLAP`   | `100`                                   | Overlap between chunks     |

### Backend Configuration

| Variable               | Default      | Description                                     |
| ---------------------- | ------------ | ----------------------------------------------- |
| `PORT`                 | `4000`       | Backend server port                             |
| `LLM_PROVIDER`         | `claude`     | Default LLM (claude/openrouter/gemini/deepseek) |
| `LLM_FALLBACK`         | `openrouter` | Fallback if primary fails                       |
| `STT_PROVIDER`         | `whisper`    | STT engine                                      |
| `TTS_PROVIDER`         | `gtts`       | TTS engine                                      |
| `CONFIDENCE_THRESHOLD` | `0.7`        | Min STT confidence                              |
| `SESSION_STORE`        | `memory`     | `memory` or `redis`                             |

### Frontend Configuration

| Variable       | Default                 | Description          |
| -------------- | ----------------------- | -------------------- |
| `VITE_API_URL` | `http://localhost:4000` | Backend API endpoint |
| `VITE_WS_URL`  | `ws://localhost:4000`   | WebSocket endpoint   |

---

## 🎯 Design Decisions & Rationale

### 1. **Modular Microservices Architecture**

- **Why**: Separation of concerns allows independent scaling and technology choices (Python for ML, Node.js for real-time I/O)
- **Tradeoff**: Increased deployment complexity (mitigated by Docker Compose)

### 2. **FAISS for Vector Search**

- **Why**: Fast, local, no external dependencies, proven at scale
- **Alternative**: Weaviate/Milvis for production with distributed requirements

### 3. **Multilingual Sentence Transformers**

- **Why**: `paraphrase-multilingual-mpnet-base-v2` supports 50+ languages including Hindi with strong semantic understanding
- **Tradeoff**: Larger model size (~420MB) but superior quality vs. language-specific models

### 4. **gTTS with Chunking**

- **Why**: Free, simple, no API keys required; chunking solves 1000-char limit
- **Alternative**: Coqui TTS (local, higher quality), Azure/ElevenLabs (paid, production-grade)

### 5. **Whisper for STT**

- **Why**: State-of-the-art multilingual transcription, works offline
- **Tradeoff**: Requires GPU for real-time (CPU is slower); can swap to Vosk/Google Cloud STT

### 6. **In-Memory Session Store with Redis Fallback**

- **Why**: Simple for demo/development; Redis for production persistence
- **Migration Path**: Environment variable switch, no code changes

### 7. **Citation-Enforced RAG**

- **Why**: Reduces hallucinations by requiring LLM to ground answers in retrieved documents
- **Implementation**: System prompt instructs LLM to cite sources; backend validates citations match RAG hits

### 8. **Provider Abstraction for LLM**

- **Why**: Vendor lock-in avoidance, cost optimization, graceful degradation
- **Supported**: Claude (primary), OpenRouter (aggregator), Gemini (Google), DeepSeek (cost-effective)

---

## 🧪 Testing

### Unit Tests

```bash
# RAG Service Tests
cd packages/rag_service
pytest tests/test_retrieve.py -v

# Backend Tests (if implemented)
cd packages/backend
npm test
```

### Manual Testing Checklist

- [ ] PDF ingestion completes without errors
- [ ] RAG retrieval returns relevant chunks with metadata
- [ ] STT transcribes Hindi and English audio with >70% confidence
- [ ] TTS generates audio for responses >1000 characters
- [ ] LLM responses include citations when RAG hits available
- [ ] Low-confidence STT triggers re-record prompt in UI
- [ ] Language switcher toggles between English and Hindi
- [ ] Session history persists across multiple messages

---

## 🔐 Security Notes

- **API Keys**: Never commit `.env` files to version control
- **Input Validation**: All user inputs (text, audio) are sanitized before processing
- **Rate Limiting**: Implement rate limiting on backend endpoints for production
- **CORS**: Configure CORS whitelist for production (currently allows all origins in dev)

---

## 📚 Dependencies

### Core Libraries

- **Frontend**: React 18, Vite, Web Audio API
- **Backend**: Express 4, Socket.IO, Axios, Multer (file uploads)
- **RAG Service**: FastAPI, sentence-transformers, faiss-cpu, pypdf, pdfplumber
- **LLM**: Anthropic SDK (Claude), OpenRouter client
- **STT/TTS**: openai-whisper (local), gTTS, ffmpeg-python

---

## 🚧 Roadmap

- [ ] Add voice activity detection (VAD) to filter silence in audio
- [ ] Implement streaming TTS for real-time audio playback
- [ ] Add support for more Indian languages (Tamil, Telugu, Bengali)
- [ ] Build admin dashboard for PDF management and analytics
- [ ] Integrate with banking APIs for live data (account balance, transactions)
- [ ] Add user authentication and conversation history persistence
- [ ] Deploy to cloud with Kubernetes (scalable architecture)

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📞 Support

For issues or questions:

- Open an issue on GitHub
- Email: support@shankh.ai (example)
- Documentation: [Link to detailed docs]

---

**Built with ❤️ for financial inclusion and multilingual accessibility**
