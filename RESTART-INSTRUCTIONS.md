# Quick Fix Instructions

## 🔧 Immediate Actions Required

### Step 1: Stop the Backend Terminal

1. Find the terminal window that shows: `Server running on port 4000`
2. Press `CTRL+C` to stop it
3. The window should close or show it stopped

### Step 2: Restart Backend

Open a new PowerShell terminal and run:

```powershell
cd "d:\Coding\Web development\Production\InfinityPool\CFS (Chatbot From Scratch)\packages\backend"
node server.js
```

**You should see:**

```
✓ RAG Service: connected (http://127.0.0.1:8000)
✓ LLM: Claude Sonnet
- RAG: ✓
```

### Step 3: Test RAG

Go to http://localhost:5173 and ask:
**"What is the minimum balance requirement for a savings account?"**

**Expected result:**

- Should show "Sources:" section at the bottom
- Should cite `149[1].pdf` or `151.pdf`
- Should show page numbers
- Should show excerpts from the PDF

---

## 📋 Why This Fix Works

**Problem:** Backend was trying to connect to RAG service via IPv6 (::1:8000) instead of IPv4
**Solution:** Changed `RAG_SERVICE_URL` from `http://localhost:8000` to `http://127.0.0.1:8000`
**Result:** Forces IPv4 connection which works properly on Windows

---

## ✅ After Restart - Verification Checklist

### Backend Terminal Should Show:

```
======================================================================
  Shankh.ai Backend Server
======================================================================
  Server running on port 4000
  Environment: development

  Features:
    - LLM:     ✓ (Claude)
    - STT:     ✓ (Whisper)
    - TTS:     ✓ (gTTS)
    - RAG:     ✓

  RAG Service: http://127.0.0.1:8000 ✓
======================================================================
```

### When You Send a Message:

```
[Chat] Text from <session-id>: "What is the minimum..."
[RAG] Retrieved 5 document(s)
[LLM] Calling Claude...
[TTS] Generated audio: /audio/xxx.mp3
```

### Frontend Should Show:

- User message
- Assistant response with **Sources** section below
- Filename (149[1].pdf or 151.pdf)
- Page numbers (e.g., "p. 45-47")
- Excerpt from the PDF
- Play audio button (🔊)

---

## 🎯 Test Questions That MUST Use RAG

These questions should ONLY be answerable from your PDFs:

1. **"What is the minimum balance requirement for a savings account?"**

   - Should cite specific amounts from the PDF
   - Should reference account types mentioned in documents

2. **"What documents are required to open a bank account?"**

   - Should list specific documents from the PDF
   - Should cite page numbers

3. **"What are the eligibility criteria for a home loan?"**
   - Should reference specific criteria from documents
   - Should show excerpts about loan requirements

If you get generic responses instead of PDF-specific content, it means RAG is not working.

---

## 🐛 Still Not Working?

### Check 1: RAG Service is Running

Open http://127.0.0.1:8000/status in browser
Should return:

```json
{
  "status": "ok",
  "index_loaded": true,
  "num_documents": 3734
}
```

### Check 2: Backend Can Connect to RAG

Open http://localhost:4000/status in browser
Should show:

```json
{
  "backend": "ready",
  "rag": "ok"
}
```

### Check 3: Check Backend Console

Look for:

```
[RAG] Retrieved 5 document(s)
```

If you see:

```
[RAG] Retrieval failed: connect ECONNREFUSED
```

Then the backend still hasn't restarted properly.

---

## 🔊 Audio Playback Fix

The audio issue should also be fixed after backend restart because:

1. TTS service will generate proper audio files
2. Frontend now uses absolute URLs: `http://localhost:4000/audio/xxx.mp3`
3. Audio files are served from `/audio` static route

**Test:** Click the speaker icon (🔊) next to any assistant message

---

## 🎤 Whisper Transcription

After backend restart, Whisper should work because:

1. Backend will connect to RAG service at `http://127.0.0.1:8000/transcribe`
2. RAG service has Whisper model loaded (you saw "✓ Whisper model loaded")

**Test:** Click microphone → speak → click stop → should transcribe

If it fails, check:

- Browser granted microphone permission
- Audio format is supported (WebM/WAV/MP3)
- RAG service console for transcription logs
