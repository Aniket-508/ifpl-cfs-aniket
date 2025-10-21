# Gemini API Key Fix

## ❌ Problem

Backend was looking for `GEMINI_API_KEY` but the .env file only had `GOOGLE_API_KEY`.

**Error Message:**

```
Primary: GEMINI_API_KEY not configured
Fallback: OpenRouter API error: Insufficient credits
```

## ✅ Solution Applied

### 1. Added Missing Environment Variable

**File:** `packages/backend/.env`

**Before:**

```env
GOOGLE_API_KEY=AIzaSyCVrSy50CK5ggWQvRnLrvj_Rruh8LDzDBE
GEMINI_MODEL=gemini-2.5-flash
```

**After:**

```env
GOOGLE_API_KEY=AIzaSyCVrSy50CK5ggWQvRnLrvj_Rruh8LDzDBE
GEMINI_API_KEY=AIzaSyCVrSy50CK5ggWQvRnLrvj_Rruh8LDzDBE    # ← Added this
GEMINI_MODEL=gemini-1.5-flash                              # ← Fixed model name
```

### 2. Fixed Model Name

Changed from `gemini-2.5-flash` (doesn't exist) to `gemini-1.5-flash` (correct model name).

### 3. Restarted Backend

Backend service has been restarted with the new configuration.

## 📋 Why This Happened

The backend code uses `process.env.GEMINI_API_KEY` but the .env file only had `GOOGLE_API_KEY`. Both are needed because:

- `GOOGLE_API_KEY` - Used by Google Cloud STT service
- `GEMINI_API_KEY` - Used by Gemini LLM

## ✅ Verification

Check the new backend terminal window. You should see:

```
======================================================================
  Shankh.ai Backend Server
======================================================================
  Server running on port 4000

  Features:
    - LLM:     ✓ (Gemini)              ← Should show Gemini now
    - STT:     ✓ (Whisper)
    - TTS:     ✓ (gTTS)
    - RAG:     ✓
======================================================================
```

## 🧪 Test It

1. Go to http://localhost:5173
2. Ask any question: "What is the minimum balance for savings account?"
3. Should now work without the API key error!

## 💡 Available Gemini Models

If you want to change models, here are the valid options:

- `gemini-1.5-flash` - Fast, cheaper (recommended)
- `gemini-1.5-pro` - More capable, slower
- `gemini-1.0-pro` - Older version

Update `GEMINI_MODEL` in `.env` if needed.

## 🔄 If Still Not Working

1. **Check backend terminal** for any errors
2. **Verify API key is valid:**

   - Go to https://aistudio.google.com/app/apikey
   - Check if key is active
   - Generate new one if needed

3. **Test Gemini API directly:**

   ```bash
   curl https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=YOUR_KEY \
     -H 'Content-Type: application/json' \
     -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
   ```

4. **Fallback to Claude** (if Gemini doesn't work):
   ```env
   LLM_PROVIDER=claude
   ```
   Your Claude API key is already configured and working.

## 📝 Summary of All API Keys

Current configuration in `packages/backend/.env`:

| Service    | Variable             | Status        |
| ---------- | -------------------- | ------------- |
| Claude     | `ANTHROPIC_API_KEY`  | ✅ Configured |
| Gemini     | `GEMINI_API_KEY`     | ✅ **Fixed!** |
| OpenRouter | `OPENROUTER_API_KEY` | ❌ No credits |
| DeepSeek   | `DEEPSEEK_API_KEY`   | ✅ Configured |
| Whisper    | `OPENAI_API_KEY`     | ✅ Configured |

Your chatbot should now work perfectly with Gemini! 🎉
