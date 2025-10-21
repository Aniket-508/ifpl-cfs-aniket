# Shankh.ai - Complete Setup Summary

## ✅ All Changes Applied

### 1. Changed LLM Provider to Gemini

- **File:** `packages/backend/.env`
- **Change:** `LLM_PROVIDER=gemini`
- **Why:** Uses Google Gemini 2.5 Flash (faster and free tier available)
- **Restart Required:** Yes (backend only)

### 2. Explained 3 Terminal Services

**All 3 services are REQUIRED:**

#### Service 1: RAG Service (Port 8000)

- **Technology:** Python FastAPI
- **Purpose:**
  - PDF semantic search (3,734 chunks indexed)
  - Whisper speech transcription
  - **NEW:** Stock price fetching (yfinance)
- **Start Command:**
  ```powershell
  cd packages\rag_service
  python server.py
  ```
- **Check:** http://localhost:8000/status

#### Service 2: Backend (Port 4000)

- **Technology:** Node.js Express + Socket.IO
- **Purpose:**
  - Main API server
  - LLM orchestration (Gemini/Claude/OpenRouter/DeepSeek)
  - STT/TTS integration
  - Session management
- **Start Command:**
  ```powershell
  cd packages\backend
  node server.js
  ```
- **Check:** http://localhost:4000/status

#### Service 3: Frontend (Port 5173)

- **Technology:** React + Vite
- **Purpose:**
  - User interface
  - Chat UI with voice input
  - Real-time WebSocket updates
- **Start Command:**
  ```powershell
  cd packages\frontend
  npm run dev
  ```
- **Check:** http://localhost:5173

**Easy Startup:** Run `.\start-dev.ps1` from root directory to start all 3!

### 3. Stock Price Integration (yfinance)

Added complete stock price functionality for Indian markets!

#### New Files Created:

1. **`packages/rag_service/stock_service.py`**

   - StockPriceService class
   - Supports NSE/BSE symbols
   - 5-minute caching
   - 20+ pre-configured popular stocks

2. **Updated `packages/rag_service/server.py`**

   - Added 4 new stock endpoints
   - Integrated with main RAG service

3. **Updated `packages/rag_service/requirements.txt`**
   - Added yfinance==0.2.28

#### New API Endpoints:

##### 1. Get Single Stock Price

```bash
POST http://localhost:8000/stock/price
{
  "symbol": "RELIANCE"
}
```

**Response:**

```json
{
  "symbol": "RELIANCE",
  "current_price": 2456.75,
  "company_name": "Reliance Industries",
  "change": 12.5,
  "change_percent": 0.51,
  "previous_close": 2444.25,
  "day_high": 2465.0,
  "day_low": 2440.3,
  "volume": 5234567,
  "market_cap": 16500000000000,
  "pe_ratio": 25.4,
  "currency": "INR",
  "timestamp": "2025-10-11T10:30:00"
}
```

##### 2. Get Multiple Stocks

```bash
POST http://localhost:8000/stock/multiple
{
  "symbols": ["TCS", "INFY", "WIPRO"]
}
```

##### 3. Search Stocks

```bash
POST http://localhost:8000/stock/search
{
  "query": "bank"
}
```

**Returns:** HDFCBANK, ICICIBANK, SBIN, KOTAKBANK, AXISBANK

##### 4. Get Market Indices

```bash
GET http://localhost:8000/stock/indices
```

**Returns:** Current values of Nifty 50, Sensex, Bank Nifty

#### Supported Stock Symbols:

**Indian Stocks (NSE):**

- RELIANCE - Reliance Industries
- TCS - Tata Consultancy Services
- HDFCBANK - HDFC Bank
- INFY - Infosys
- ICICIBANK - ICICI Bank
- HINDUNILVR - Hindustan Unilever
- ITC - ITC Limited
- SBIN - State Bank of India
- BHARTIARTL - Bharti Airtel
- KOTAKBANK - Kotak Mahindra Bank
- WIPRO - Wipro
- BAJFINANCE - Bajaj Finance
- ASIANPAINT - Asian Paints
- MARUTI - Maruti Suzuki
- AXISBANK - Axis Bank
- LT - Larsen & Toubro
- TITAN - Titan Company
- SUNPHARMA - Sun Pharmaceutical
- ULTRACEMCO - UltraTech Cement
- NESTLEIND - Nestle India

**Market Indices:**

- NIFTY - Nifty 50
- SENSEX - BSE Sensex
- BANKNIFTY - Bank Nifty

#### Symbol Format:

- NSE: `RELIANCE.NS` (auto-added)
- BSE: `RELIANCE.BO` (specify explicitly)
- Indices: `^NSEI`, `^BSESN`, `^NSEBANK`

---

## 🚀 Complete Restart Instructions

### Option 1: Use Start Script (Recommended)

```powershell
cd "d:\Coding\Web development\Production\InfinityPool\CFS (Chatbot From Scratch)"
.\start-dev.ps1
```

This opens 3 terminal windows automatically!

### Option 2: Manual Start (if script fails)

Open 3 PowerShell terminals:

**Terminal 1 - RAG Service:**

```powershell
cd "d:\Coding\Web development\Production\InfinityPool\CFS (Chatbot From Scratch)\packages\rag_service"
python server.py
```

**Terminal 2 - Backend:**

```powershell
cd "d:\Coding\Web development\Production\InfinityPool\CFS (Chatbot From Scratch)\packages\backend"
node server.js
```

**Terminal 3 - Frontend:**

```powershell
cd "d:\Coding\Web development\Production\InfinityPool\CFS (Chatbot From Scratch)\packages\frontend"
npm run dev
```

---

## 🧪 Testing Stock Integration

### Test 1: Direct API Call

```bash
curl -X POST http://localhost:8000/stock/price \
  -H "Content-Type: application/json" \
  -d '{"symbol":"RELIANCE"}'
```

### Test 2: Ask Chatbot

Go to http://localhost:5173 and ask:

- "What is the current price of Reliance stock?"
- "Get me TCS, Infosys and Wipro stock prices"
- "What's the Nifty 50 index value?"
- "Search for bank stocks"

The LLM will automatically use the stock endpoints when you ask about stock prices!

---

## 📊 How LLM Uses Stock Data

The backend can be configured to give LLM access to stock tools. Here's how it works:

1. **User asks:** "What's Reliance stock price?"
2. **LLM detects** stock query
3. **Backend calls** `http://localhost:8000/stock/price`
4. **LLM receives** real-time data
5. **Response includes:** Current price, change, company info

---

## ✅ Verification Checklist

After restart, check all 3 services:

### RAG Service ✓

- [ ] Terminal shows: `✓ Model loaded (dim: 768)`
- [ ] Terminal shows: `✓ Loaded index with 3734 vectors`
- [ ] Terminal shows: `✓ Whisper model loaded`
- [ ] Browser: http://localhost:8000/status returns `"status": "ok"`
- [ ] Test stock: http://localhost:8000/stock/indices works

### Backend ✓

- [ ] Terminal shows: `Server running on port 4000`
- [ ] Terminal shows: `- LLM: ✓ (Gemini)`
- [ ] Terminal shows: `- RAG: ✓`
- [ ] Terminal shows: `RAG Service: http://127.0.0.1:8000 ✓`
- [ ] Browser: http://localhost:4000/status returns `"backend": "ready"`

### Frontend ✓

- [ ] Terminal shows: `Local: http://localhost:5173/`
- [ ] Browser: http://localhost:5173 loads chat interface
- [ ] No console errors in browser DevTools

---

## 🎯 Example Queries

### RAG-Based (from PDFs):

- "What is the minimum balance requirement for a savings account?"
- "What documents are required to open a bank account?"
- "Explain the loan eligibility criteria"

### Stock-Based (real-time):

- "What's the current price of Reliance Industries?"
- "Get me the stock prices for TCS, Infosys and HCL"
- "What's the Nifty 50 at right now?"
- "Show me all bank stocks"

### Combined:

- "Compare HDFC Bank stock price with their minimum account balance requirements"

---

## 🔧 Environment Summary

| Variable          | Value                   | Purpose                           |
| ----------------- | ----------------------- | --------------------------------- |
| `LLM_PROVIDER`    | `gemini`                | Primary LLM (changed from claude) |
| `GEMINI_MODEL`    | `gemini-2.5-flash`      | Fast, free tier available         |
| `RAG_SERVICE_URL` | `http://127.0.0.1:8000` | IPv4 fix for Windows              |
| `ENABLE_RAG`      | `true`                  | PDF retrieval enabled             |
| `STT_PROVIDER`    | `whisper`               | Speech transcription              |
| `TTS_PROVIDER`    | `gtts`                  | Text-to-speech                    |

---

## 📁 Project Structure

```
CFS (Chatbot From Scratch)/
├── .env                          # Root config
├── start-dev.ps1                 # Start all services
├── restart-backend.ps1           # Restart backend only
├── data/
│   ├── pdfs/                     # Your PDF files
│   │   ├── 149[1].pdf
│   │   └── 151.pdf
│   └── faiss_index/              # Generated index
│       ├── faiss_index.bin       # 3,734 vectors
│       └── metadata.pkl
├── packages/
│   ├── rag_service/              # Port 8000
│   │   ├── server.py             # ✨ Updated with stock endpoints
│   │   ├── stock_service.py      # ✨ NEW stock integration
│   │   ├── ingest.py
│   │   └── requirements.txt      # ✨ Added yfinance
│   ├── backend/                  # Port 4000
│   │   ├── server.js
│   │   ├── llmAdapter.js
│   │   ├── sttService.js
│   │   ├── ttsService.js
│   │   └── .env                  # ✨ LLM_PROVIDER=gemini
│   └── frontend/                 # Port 5173
│       ├── src/
│       │   └── App.jsx
│       └── package.json
```

---

## 🎉 What's New

1. ✅ **LLM Provider:** Switched to Gemini (faster, free tier)
2. ✅ **Stock Integration:** Real-time Indian stock prices via yfinance
3. ✅ **New Endpoints:** 4 stock-related API endpoints
4. ✅ **IPv4 Fix:** RAG service connection fixed
5. ✅ **Documentation:** Complete setup and testing guide

---

## 💡 Pro Tips

1. **Stock Cache:** Prices cached for 5 minutes to save API calls
2. **Symbol Format:** Don't need to add .NS - auto-added for NSE
3. **Indices:** Use keywords: 'nifty', 'sensex', 'banknifty'
4. **Search:** Use `POST /stock/search` to find symbol for company name
5. **Historical:** Stock service supports historical data (not exposed yet)

---

## 🐛 Troubleshooting

### Stock endpoints not working?

1. Check RAG service terminal for errors
2. Verify yfinance installed: `pip list | grep yfinance`
3. Test directly: `curl http://localhost:8000/stock/indices`

### LLM still using Claude?

1. Check `packages/backend/.env` has `LLM_PROVIDER=gemini`
2. Restart backend: `.\restart-backend.ps1`
3. Check backend terminal shows `- LLM: ✓ (Gemini)`

### Services not starting?

1. Kill all processes: `Get-Process | Where {$_.Name -like "*node*" -or $_.Name -like "*python*"} | Stop-Process -Force`
2. Run `.\start-dev.ps1` again

---

## 📞 Quick Commands Reference

```powershell
# Start everything
.\start-dev.ps1

# Restart backend only
.\restart-backend.ps1

# Kill all services
Get-Process | Where {$_.Name -like "*node*" -or $_.Name -like "*python*"} | Stop-Process -Force

# Test stock API
curl http://localhost:8000/stock/indices

# Check service status
curl http://localhost:8000/status
curl http://localhost:4000/status
```

Enjoy your enhanced Shankh.ai chatbot with real-time stock prices! 🚀📈
