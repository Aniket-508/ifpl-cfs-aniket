/**
 * Shankh.ai Backend Server
 *
 * Express + Socket.IO server providing chat endpoints with:
 * - Audio upload & transcription (STT)
 * - Text chat input
 * - RAG retrieval integration
 * - LLM response generation with citations
 * - TTS audio synthesis
 * - Session memory (in-memory or Redis)
 * - Real-time WebSocket updates
 *
 * @module server
 */

import express from "express";
import { createServer } from "http";
import { Server as SocketIO } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

// Import services
import { callLLM, getProviderStatus } from "./llmAdapter.js";
import { transcribeAudio, getSTTStatus } from "./sttService.js";
import { synthesizeTTS, cleanupOldAudio, getTTSStatus } from "./ttsService.js";

dotenv.config();

// ES module __dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server Configuration
 */
const config = {
  port: parseInt(process.env.PORT) || 4000,
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",

  // CORS
  corsOrigins: (
    process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:3000"
  ).split(","),

  // RAG Service
  ragServiceUrl: process.env.RAG_SERVICE_URL || "http://localhost:8000",
  ragTopK: parseInt(process.env.RAG_TOP_K) || 5,
  ragThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD) || 0.5,

  // Session
  sessionStore: process.env.SESSION_STORE || "memory",
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 3600,
  maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY) || 20,

  // File upload
  maxAudioSize: parseInt(process.env.MAX_AUDIO_SIZE) || 10485760, // 10MB
  tempDir: process.env.TEMP_DIR || "./temp",

  // Rate limiting
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 min
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,

  // Feature flags
  enableTTS: process.env.ENABLE_TTS !== "false",
  enableSTT: process.env.ENABLE_STT !== "false",
  enableRAG: process.env.ENABLE_RAG !== "false",
  requireRagCitations: process.env.REQUIRE_RAG_CITATIONS !== "false",
};

// Ensure temp directory exists
if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir, { recursive: true });
}

/**
 * Stock Detection and Fetching Functions
 */

// Common Indian stock symbols and their variations
const STOCK_SYMBOLS = {
  // Major NSE stocks
  reliance: "RELIANCE.NS",
  tcs: "TCS.NS",
  infosys: "INFY.NS",
  infy: "INFY.NS",
  hdfc: "HDFCBANK.NS",
  hdfcbank: "HDFCBANK.NS",
  icicibank: "ICICIBANK.NS",
  icici: "ICICIBANK.NS",
  sbi: "SBIN.NS",
  wipro: "WIPRO.NS",
  bhartiairtel: "BHARTIARTL.NS",
  airtel: "BHARTIARTL.NS",
  itc: "ITC.NS",
  hul: "HINDUNILVR.NS",
  hindunilvr: "HINDUNILVR.NS",
  maruti: "MARUTI.NS",
  bajajfinance: "BAJFINANCE.NS",
  bajajfinsv: "BAJAJFINSV.NS",
  asianpaints: "ASIANPAINT.NS",
  ltim: "LTIM.NS",
  hcltech: "HCLTECH.NS",
  powergrid: "POWERGRID.NS",
  ntpc: "NTPC.NS",
  coalindia: "COALINDIA.NS",
  ongc: "ONGC.NS",
  tatasteel: "TATASTEEL.NS",
  jswsteel: "JSWSTEEL.NS",
  // Add BSE variants
  "reliance.bo": "RELIANCE.BO",
  "tcs.bo": "TCS.BO",
};

// Stock-related keywords
const STOCK_KEYWORDS = [
  "stock price",
  "share price",
  "stock",
  "share",
  "equity",
  "nse",
  "bse",
  "trading",
  "market price",
  "current price",
  "price of",
  "quote",
  "stock market",
  "shares",
  "stocks",
];

/**
 * Detect stock queries in user text
 * @param {string} text - User query text
 * @returns {Array} Array of detected stock symbols
 */
function detectStockQuery(text) {
  const lowerText = text.toLowerCase();
  const detectedStocks = [];

  // Check if text contains stock-related keywords
  const hasStockKeywords = STOCK_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase())
  );

  if (!hasStockKeywords) {
    return detectedStocks;
  }

  // Look for stock symbols in the text
  Object.keys(STOCK_SYMBOLS).forEach((key) => {
    if (lowerText.includes(key.toLowerCase())) {
      const symbol = STOCK_SYMBOLS[key];
      if (!detectedStocks.includes(symbol)) {
        detectedStocks.push(symbol);
      }
    }
  });

  // Also check for direct .NS or .BO patterns
  const symbolPattern = /([A-Z]+)\.(NS|BO)/gi;
  const matches = lowerText.match(symbolPattern);
  if (matches) {
    matches.forEach((match) => {
      const symbol = match.toUpperCase();
      if (!detectedStocks.includes(symbol)) {
        detectedStocks.push(symbol);
      }
    });
  }

  return detectedStocks;
}

/**
 * Fetch stock prices from RAG service
 * @param {Array} symbols - Array of stock symbols
 * @returns {Promise<Array>} Stock price data
 */
async function fetchMultipleStockPrices(symbols) {
  try {
    const response = await axios.post(
      `${config.ragServiceUrl}/stock/multiple`,
      {
        symbols: symbols,
      },
      { timeout: 10000 }
    );

    return response.data.stocks || [];
  } catch (error) {
    console.error("Stock fetch error:", error.message);
    throw error;
  }
}

/**
 * Initialize Express app
 */
const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: {
    origin: config.corsOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

/**
 * In-memory session store
 */
class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.timeouts = new Map();
  }

  get(sessionId) {
    return this.sessions.get(sessionId);
  }

  set(sessionId, data) {
    this.sessions.set(sessionId, {
      ...data,
      lastActivity: Date.now(),
    });
    this.refreshTimeout(sessionId);
  }

  update(sessionId, updates) {
    const session = this.get(sessionId);
    if (session) {
      this.set(sessionId, { ...session, ...updates });
    }
  }

  delete(sessionId) {
    this.sessions.delete(sessionId);
    const timeout = this.timeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(sessionId);
    }
  }

  refreshTimeout(sessionId) {
    // Clear existing timeout
    const existingTimeout = this.timeouts.get(sessionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      console.log(`[Session] Expired: ${sessionId}`);
      this.delete(sessionId);
    }, config.sessionTimeout * 1000);

    this.timeouts.set(sessionId, timeout);
  }

  addMessage(sessionId, role, content, metadata = {}) {
    const session = this.get(sessionId) || { history: [] };
    session.history = session.history || [];

    session.history.push({
      role,
      content,
      timestamp: Date.now(),
      ...metadata,
    });

    // Keep only recent history
    if (session.history.length > config.maxConversationHistory) {
      session.history = session.history.slice(-config.maxConversationHistory);
    }

    this.set(sessionId, session);
  }

  getHistory(sessionId) {
    const session = this.get(sessionId);
    return session?.history || [];
  }
}

const sessionStore = new SessionStore();

/**
 * Middleware
 */
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable for development
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
);
app.use(morgan(process.env.LOG_FORMAT || "dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindow,
  max: config.rateLimitMax,
  message: "Too many requests from this IP, please try again later.",
});
app.use("/chat", limiter);

// Serve static audio files
app.use("/audio", express.static(config.tempDir));

// Multer for file uploads
const upload = multer({
  dest: config.tempDir,
  limits: { fileSize: config.maxAudioSize },
  fileFilter: (req, file, cb) => {
    const allowedFormats = (
      process.env.ALLOWED_AUDIO_FORMATS ||
      "audio/wav,audio/mpeg,audio/mp3,audio/webm,audio/ogg"
    ).split(",");
    if (allowedFormats.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(`Invalid audio format. Allowed: ${allowedFormats.join(", ")}`)
      );
    }
  },
});

/**
 * Routes
 */

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "shankh-ai-backend",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Service status
app.get("/status", async (req, res) => {
  try {
    // Check RAG service
    let ragStatus = "unknown";
    try {
      const ragResponse = await axios.get(`${config.ragServiceUrl}/status`, {
        timeout: 3000,
      });
      ragStatus = ragResponse.data.status;
    } catch {
      ragStatus = "unavailable";
    }

    res.json({
      backend: "ready",
      rag: ragStatus,
      llm: getProviderStatus(),
      stt: getSTTStatus(),
      tts: getTTSStatus(),
      session: {
        store: config.sessionStore,
        activeSessions: sessionStore.sessions.size,
      },
      features: {
        tts: config.enableTTS,
        stt: config.enableSTT,
        rag: config.enableRAG,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /chat/sendText - Text-based chat
app.post("/chat/sendText", async (req, res) => {
  const { sessionId, text, language } = req.body;

  if (!sessionId || !text) {
    return res.status(400).json({ error: "sessionId and text are required" });
  }

  console.log(`[Chat] Text from ${sessionId}: "${text.substring(0, 50)}..."`);

  try {
    // Add user message to history
    sessionStore.addMessage(sessionId, "user", text);

    // 1. Retrieve relevant documents from RAG
    let ragHits = [];
    if (config.enableRAG) {
      try {
        const ragResponse = await axios.post(
          `${config.ragServiceUrl}/retrieve`,
          {
            query: text,
            k: config.ragTopK,
            threshold: config.ragThreshold,
            lang_hint: language,
          },
          { timeout: 10000 }
        );

        ragHits = ragResponse.data.results || [];
        console.log(`[RAG] Retrieved ${ragHits.length} document(s)`);
      } catch (ragError) {
        console.error("[RAG] Retrieval failed:", ragError.message);
        // Continue without RAG
      }
    }

    // 2. Check for stock queries and fetch stock data
    let stockData = null;
    const stockQueries = detectStockQuery(text);
    if (stockQueries.length > 0) {
      try {
        console.log(
          `[STOCK] Detected stock queries: ${stockQueries.join(", ")}`
        );
        stockData = await fetchMultipleStockPrices(stockQueries);
        console.log(`[STOCK] Retrieved prices for ${stockData.length} stocks`);
      } catch (stockError) {
        console.error("[STOCK] Price fetch failed:", stockError.message);
        // Continue without stock data
      }
    }

    // 3. Get conversation history
    const history = sessionStore.getHistory(sessionId);

    // 4. Call LLM (with stock data if available)
    const llmResponse = await callLLM({
      userQuery: text,
      languageHint: language || "en",
      ragHits,
      sessionHistory: history,
      requireRag: config.requireRagCitations,
      stockData, // Add stock data for LLM context
    });

    // Add assistant message to history
    sessionStore.addMessage(sessionId, "assistant", llmResponse.text, {
      rag_sources: llmResponse.rag_sources,
    });

    // 4. Generate TTS audio
    let ttsResult = null;
    if (config.enableTTS) {
      try {
        ttsResult = await synthesizeTTS(llmResponse.text, llmResponse.language);
        console.log(`[TTS] Generated audio: ${ttsResult.audioUrl}`);
      } catch (ttsError) {
        console.error("[TTS] Synthesis failed:", ttsError.message);
        // Continue without TTS
      }
    }

    // 5. Emit via WebSocket if client is connected
    io.to(sessionId).emit("message", {
      role: "assistant",
      text: llmResponse.text,
      html_formatted: llmResponse.html_formatted,
      language: llmResponse.language,
      rag_sources: llmResponse.rag_sources,
      follow_up_questions: llmResponse.follow_up_questions,
      tts_audio_url: ttsResult?.audioUrl,
    });

    // 6. Return response
    res.json({
      text: llmResponse.text,
      html_formatted: llmResponse.html_formatted,
      language: llmResponse.language,
      rag_sources: llmResponse.rag_sources,
      follow_up_questions: llmResponse.follow_up_questions,
      needs_verification: llmResponse.needs_verification,
      tts_audio_url: ttsResult?.audioUrl || null,
      llm_provider: llmResponse.metadata.provider,
      session_id: sessionId,
    });
  } catch (error) {
    console.error("[Chat] Error:", error.message);
    res.status(500).json({
      error: "Failed to process chat message",
      details: error.message,
    });
  }
});

// POST /chat/sendAudio - Audio-based chat
app.post("/chat/sendAudio", upload.single("audio"), async (req, res) => {
  const { sessionId, language } = req.body;
  const audioFile = req.file;

  if (!sessionId || !audioFile) {
    return res
      .status(400)
      .json({ error: "sessionId and audio file are required" });
  }

  console.log(`[Chat] Audio from ${sessionId}: ${audioFile.originalname}`);

  try {
    // 1. Transcribe audio
    if (!config.enableSTT) {
      throw new Error("STT is disabled");
    }

    const transcription = await transcribeAudio(audioFile.path, { language });
    console.log(
      `[STT] Transcribed: "${transcription.text.substring(0, 50)}..." (${transcription.language})`
    );

    // Clean up uploaded file
    fs.unlinkSync(audioFile.path);

    // Check confidence
    if (transcription.low_confidence) {
      return res.json({
        transcription: transcription.text,
        language: transcription.language,
        confidence: transcription.confidence,
        low_confidence: true,
        message: "Low confidence transcription. Please confirm or re-record.",
        session_id: sessionId,
      });
    }

    // Add user message (transcribed)
    sessionStore.addMessage(sessionId, "user", transcription.text);

    // 2. Continue with same flow as sendText
    // Retrieve RAG documents
    let ragHits = [];
    if (config.enableRAG) {
      try {
        const ragResponse = await axios.post(
          `${config.ragServiceUrl}/retrieve`,
          {
            query: transcription.text,
            k: config.ragTopK,
            threshold: config.ragThreshold,
            lang_hint: transcription.language,
          },
          { timeout: 10000 }
        );

        ragHits = ragResponse.data.results || [];
        console.log(`[RAG] Retrieved ${ragHits.length} document(s)`);
      } catch (ragError) {
        console.error("[RAG] Retrieval failed:", ragError.message);
      }
    }

    // Get history
    const history = sessionStore.getHistory(sessionId);

    // Call LLM
    const llmResponse = await callLLM({
      userQuery: transcription.text,
      languageHint: transcription.language,
      ragHits,
      sessionHistory: history,
      requireRag: config.requireRagCitations,
    });

    // Add assistant message
    sessionStore.addMessage(sessionId, "assistant", llmResponse.text, {
      rag_sources: llmResponse.rag_sources,
    });

    // Generate TTS
    let ttsResult = null;
    if (config.enableTTS) {
      try {
        ttsResult = await synthesizeTTS(llmResponse.text, llmResponse.language);
        console.log(`[TTS] Generated audio: ${ttsResult.audioUrl}`);
      } catch (ttsError) {
        console.error("[TTS] Synthesis failed:", ttsError.message);
      }
    }

    // Emit via WebSocket
    io.to(sessionId).emit("message", {
      role: "assistant",
      text: llmResponse.text,
      html_formatted: llmResponse.html_formatted,
      language: llmResponse.language,
      rag_sources: llmResponse.rag_sources,
      follow_up_questions: llmResponse.follow_up_questions,
      tts_audio_url: ttsResult?.audioUrl,
    });

    // Return response
    res.json({
      transcription: transcription.text,
      transcription_language: transcription.language,
      transcription_confidence: transcription.confidence,
      text: llmResponse.text,
      html_formatted: llmResponse.html_formatted,
      language: llmResponse.language,
      rag_sources: llmResponse.rag_sources,
      follow_up_questions: llmResponse.follow_up_questions,
      needs_verification: llmResponse.needs_verification,
      tts_audio_url: ttsResult?.audioUrl || null,
      llm_provider: llmResponse.metadata.provider,
      session_id: sessionId,
    });
  } catch (error) {
    console.error("[Chat] Audio error:", error.message);

    // Clean up file on error
    if (audioFile && fs.existsSync(audioFile.path)) {
      fs.unlinkSync(audioFile.path);
    }

    res.status(500).json({
      error: "Failed to process audio message",
      details: error.message,
    });
  }
});

// GET /chat/history/:sessionId - Get conversation history
app.get("/chat/history/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const history = sessionStore.getHistory(sessionId);

  res.json({
    session_id: sessionId,
    history,
    count: history.length,
  });
});

// DELETE /chat/session/:sessionId - Clear session
app.delete("/chat/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  sessionStore.delete(sessionId);

  res.json({
    message: "Session cleared",
    session_id: sessionId,
  });
});

/**
 * WebSocket connection handling
 */
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Join session room
  socket.on("join", (sessionId) => {
    socket.join(sessionId);
    console.log(`[WS] ${socket.id} joined session: ${sessionId}`);

    socket.emit("joined", {
      sessionId,
      message: "Connected to Shankh.ai",
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });

  // Typing indicator
  socket.on("typing", (data) => {
    socket.to(data.sessionId).emit("typing", {
      sessionId: data.sessionId,
      isTyping: data.isTyping,
    });
  });
});

/**
 * Error handling
 */
app.use((err, req, res, next) => {
  console.error("[Error]", err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(config.nodeEnv === "development" && { stack: err.stack }),
  });
});

/**
 * Cleanup tasks
 */
// Clean up old audio files every hour
setInterval(async () => {
  const deleted = await cleanupOldAudio(3600000); // 1 hour
  if (deleted > 0) {
    console.log(`[Cleanup] Removed ${deleted} old audio file(s)`);
  }
}, 3600000);

/**
 * Start server
 */
httpServer.listen(config.port, config.host, () => {
  console.log("=".repeat(70));
  console.log("  🚀 Shankh.ai Backend Server Started");
  console.log("=".repeat(70));
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`  Server:      http://${config.host}:${config.port}`);
  console.log(`  Health:      http://${config.host}:${config.port}/health`);
  console.log(`  Status:      http://${config.host}:${config.port}/status`);
  console.log(`  RAG Service: ${config.ragServiceUrl}`);
  console.log("=".repeat(70));
  console.log(`  Features:`);
  console.log(`    - STT:     ${config.enableSTT ? "✓" : "✗"}`);
  console.log(`    - TTS:     ${config.enableTTS ? "✓" : "✗"}`);
  console.log(`    - RAG:     ${config.enableRAG ? "✓" : "✗"}`);
  console.log(`    - WebSocket: ✓`);
  console.log("=".repeat(70));
});

export default app;
