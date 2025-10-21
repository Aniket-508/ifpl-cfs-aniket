/**
 * LLM Adapter for Shankh.ai
 *
 * Provides unified interface for multiple LLM providers with fallback logic.
 * Supports: Claude Sonnet, OpenRouter, Gemini, DeepSeek
 *
 * Features:
 * - Provider abstraction with automatic fallback
 * - RAG citation enforcement
 * - Structured response parsing
 * - Token usage tracking
 * - Error handling and retries
 *
 * @module llmAdapter
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * LLM Configuration
 */
const config = {
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o",
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 2000,
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-1.5-pro",
    },
    claude: {
      apiKey: process.env.CLAUDE_API_KEY,
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 2000,
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
    },
  },
  primary: process.env.LLM_PROVIDER || "openai",
  fallback: process.env.LLM_FALLBACK || "openrouter",
  temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
  topP: parseFloat(process.env.LLM_TOP_P) || 0.9,
};

// Startup debugging - log configuration when module loads
console.log("=".repeat(60));
console.log("🔧 LLM ADAPTER CONFIGURATION LOADED");
console.log("=".repeat(60));
console.log(`Primary Provider: ${config.primary}`);
console.log(`Fallback Provider: ${config.fallback}`);
console.log(`LLM_PROVIDER env var: ${process.env.LLM_PROVIDER}`);
console.log(`LLM_FALLBACK env var: ${process.env.LLM_FALLBACK}`);
console.log("Available API Keys:");
console.log(
  `  - OpenAI: ${config.providers.openai.apiKey ? "✓ Present" : "✗ Missing"}`
);
console.log(
  `  - Gemini: ${config.providers.gemini.apiKey ? "✓ Present" : "✗ Missing"}`
);
console.log(
  `  - Claude: ${config.providers.claude.apiKey ? "✓ Present" : "✗ Missing"}`
);
console.log(
  `  - OpenRouter: ${config.providers.openrouter.apiKey ? "✓ Present" : "✗ Missing"}`
);
console.log("=".repeat(60));

/**
 * Build system prompt for Shankh.ai Financial Helper
 *
 * @param {Object} options - Prompt options
 * @param {string} options.userQuery - User's query text
 * @param {string} options.languageHint - Detected/specified language
 * @param {Array} options.ragHits - RAG retrieval results
 * @param {Array} options.sessionHistory - Recent conversation history
 * @param {boolean} options.requireRag - Whether to require RAG citations
 * @returns {string} System prompt
 */
function buildSystemPrompt({
  userQuery,
  languageHint,
  ragHits,
  sessionHistory,
  requireRag,
  stockData,
}) {
  const ragContext =
    ragHits && ragHits.length > 0
      ? ragHits
          .map(
            (hit, idx) =>
              `[${idx + 1}] ${hit.filename} (p.${hit.page_num}): "${hit.excerpt}" (score: ${hit.score.toFixed(3)})`
          )
          .join("\n")
      : "No RAG hits found.";

  const historyContext =
    sessionHistory && sessionHistory.length > 0
      ? sessionHistory
          .slice(-8)
          .map((msg) => `${msg.role}: ${msg.content}`)
          .join("\n")
      : "No prior conversation.";

  const stockContext =
    stockData && stockData.length > 0
      ? stockData
          .map(
            (stock, idx) =>
              `[${idx + 1}] ${stock.symbol}: ₹${stock.current_price} (${stock.change > 0 ? "+" : ""}${stock.change_percent}%) - ${stock.market_status}`
          )
          .join("\n")
      : "No stock data available.";

  return `You are the Shankh.ai Financial Helper assistant. Use the following strict guidelines:

USER_QUERY: ${userQuery}
LANGUAGE_HINT: ${languageHint || "auto-detect"}

RAG_HITS (retrieved sources):
${ragContext}

SESSION_HISTORY (last 8 messages):
${historyContext}

STOCK_DATA (live market prices):
${stockContext}

INSTRUCTIONS:
1) If RAG_HITS contains high-score results (>0.5), produce an answer that incorporates these sources and cite them inline as [source: filename p#].

2) If STOCK_DATA is available, use the live prices and market data to answer stock-related queries. Always include current price, change percentage, and market status.

3) If no RAG hits or low scores, produce an explanatory answer but prepend: "⚠️ LLM-generated (no direct source) — verify with a financial expert."

4) Keep tone explanatory and accessible. Use short paragraphs and numbered steps for advice.

5) Return ONLY valid JSON with these exact keys:
   {
     "text": "your answer text with inline citations",
     "language": "bcp47 code (e.g., 'en', 'hi')",
     "html_formatted": "HTML version with <p>, <ul>, <li> tags and <strong> for citations",
     "rag_sources": [
       {"filename": "151.pdf", "page_range": "4-5", "excerpt": "excerpt text (max 25 words)"}
     ],
     "follow_up_questions": ["Question 1?", "Question 2?", "Question 3?"],
     "needs_verification": true/false
   }

6) Do not hallucinate bank policies, interest rates, or legal conclusions. For time-sensitive or regulatory matters, instruct the user to consult a certified professional and provide validation steps.

7) If the user asks for code examples, limit to 30 lines with comments.

8) ${requireRag ? "REQUIRED: If making factual claims, you MUST cite RAG sources. If no sources available, explicitly state this is LLM-generated and needs verification." : "Cite RAG sources when available."}

9) For rag_sources array, only include sources you actually referenced in your answer.

10) Include 3 helpful follow_up_questions that logically extend the conversation.

11) Respond in the same language as the user query unless explicitly asked otherwise. Add a brief note in the alternate language explaining how to switch (e.g., "हिंदी में जवाब के लिए कहें" or "Say 'in English' for English response").

Example stock response format:
"The current price of Reliance Industries is ₹2,456.75, up 2.34% today. Market is currently open."

Example citation format:
"According to the bank policy document [source: 151.pdf p4], fixed deposits require a minimum balance of ₹10,000..."

Example citation format:
"According to the bank policy document [source: 151.pdf p4], fixed deposits require a minimum balance of ₹10,000..."

NOW RESPOND WITH ONLY THE JSON OBJECT (no other text):`;
}

/**
 * Call Claude Sonnet via Anthropic SDK
 *
 * @param {string} systemPrompt - System prompt with context
 * @param {Object} options - Call options
 * @returns {Promise<Object>} LLM response
 */
async function callClaude(systemPrompt, options = {}) {
  const { apiKey, model, maxTokens } = config.providers.claude;

  if (!apiKey) {
    throw new Error("CLAUDE_API_KEY not configured");
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: "Generate the response as specified in the system prompt.",
        },
      ],
    });

    const rawText = response.content[0].text;
    const parsed = parseStructuredResponse(rawText);

    return {
      ...parsed,
      metadata: {
        provider: "claude",
        model: response.model,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens:
            response.usage.input_tokens + response.usage.output_tokens,
        },
        finish_reason: response.stop_reason,
      },
    };
  } catch (error) {
    throw new Error(`Claude API error: ${error.message}`);
  }
}

/**
 * Call OpenRouter (aggregator supporting multiple models)
 *
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Call options
 * @returns {Promise<Object>} LLM response
 */
async function callOpenRouter(systemPrompt, options = {}) {
  const { apiKey, model, endpoint } = config.providers.openrouter;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  try {
    const response = await axios.post(
      endpoint,
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the response as specified." },
        ],
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: config.providers.claude.maxTokens,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://shankh.ai",
          "X-Title": "Shankh.ai Financial Chatbot",
        },
      }
    );

    const rawText = response.data.choices[0].message.content;
    const parsed = parseStructuredResponse(rawText);

    return {
      ...parsed,
      metadata: {
        provider: "openrouter",
        model: response.data.model,
        usage: response.data.usage || {},
        finish_reason: response.data.choices[0].finish_reason,
      },
    };
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    throw new Error(`OpenRouter API error: ${message}`);
  }
}

/**
 * Call OpenAI GPT
 *
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Call options
 * @returns {Promise<Object>} LLM response
 */
async function callOpenAI(systemPrompt, options = {}) {
  const { apiKey, model, maxTokens } = config.providers.openai;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  try {
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: "Generate the response as specified in the system prompt.",
        },
      ],
      temperature: config.temperature,
      top_p: config.topP,
      max_tokens: maxTokens,
    });

    const rawText = response.choices[0].message.content;
    const parsed = parseStructuredResponse(rawText);

    return {
      ...parsed,
      metadata: {
        provider: "openai",
        model: response.model,
        usage: {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        },
        finish_reason: response.choices[0].finish_reason,
      },
    };
  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

/**
 * Call Google Gemini
 *
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Call options
 * @returns {Promise<Object>} LLM response
 */
async function callGemini(systemPrompt, options = {}) {
  const { apiKey, model } = config.providers.gemini;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelInstance = genAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature: config.temperature,
        topP: config.topP,
        maxOutputTokens: config.providers.claude.maxTokens,
      },
    });

    // Combine system prompt with user query
    const fullPrompt = `${systemPrompt}\n\nGenerate the response now.`;

    const result = await modelInstance.generateContent(fullPrompt);
    const rawText = result.response.text();
    const parsed = parseStructuredResponse(rawText);

    return {
      ...parsed,
      metadata: {
        provider: "gemini",
        model,
        usage: {
          total_tokens: result.response.usageMetadata?.totalTokenCount || 0,
        },
        finish_reason: "stop",
      },
    };
  } catch (error) {
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

/**
 * Call DeepSeek (OpenAI-compatible API)
 *
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Call options
 * @returns {Promise<Object>} LLM response
 */
async function callDeepSeek(systemPrompt, options = {}) {
  const { apiKey, model, endpoint } = config.providers.deepseek;

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  try {
    const response = await axios.post(
      endpoint,
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the response as specified." },
        ],
        temperature: config.temperature,
        max_tokens: config.providers.claude.maxTokens,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const rawText = response.data.choices[0].message.content;
    const parsed = parseStructuredResponse(rawText);

    return {
      ...parsed,
      metadata: {
        provider: "deepseek",
        model: response.data.model,
        usage: response.data.usage || {},
        finish_reason: response.data.choices[0].finish_reason,
      },
    };
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    throw new Error(`DeepSeek API error: ${message}`);
  }
}

/**
 * Parse structured JSON response from LLM
 *
 * @param {string} rawText - Raw LLM output
 * @returns {Object} Parsed response
 */
function parseStructuredResponse(rawText) {
  try {
    // Try to extract JSON from markdown code blocks
    let jsonText = rawText.trim();

    // Remove markdown code fences if present
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    const parsed = JSON.parse(jsonText);

    // Validate required fields
    if (!parsed.text || !parsed.language) {
      throw new Error("Missing required fields: text, language");
    }

    // Set defaults for optional fields
    return {
      text: parsed.text,
      language: parsed.language,
      html_formatted: parsed.html_formatted || parsed.text,
      rag_sources: parsed.rag_sources || [],
      follow_up_questions: parsed.follow_up_questions || [],
      needs_verification: parsed.needs_verification || false,
    };
  } catch (error) {
    // Fallback: return raw text as unstructured response
    console.error("Failed to parse structured response:", error.message);
    return {
      text: rawText,
      language: "en",
      html_formatted: `<p>${rawText}</p>`,
      rag_sources: [],
      follow_up_questions: [],
      needs_verification: true,
      parse_error: true,
    };
  }
}

/**
 * Main LLM adapter function with fallback logic
 *
 * @param {Object} params - Call parameters
 * @param {string} params.userQuery - User's query
 * @param {string} params.languageHint - Language hint
 * @param {Array} params.ragHits - RAG results
 * @param {Array} params.sessionHistory - Conversation history
 * @param {boolean} params.requireRag - Require RAG citations
 * @param {Array} params.stockData - Stock price data (optional)
 * @param {string} params.provider - Specific provider to use (optional)
 * @returns {Promise<Object>} LLM response with metadata
 */
export async function callLLM({
  userQuery,
  languageHint = "en",
  ragHits = [],
  sessionHistory = [],
  requireRag = true,
  stockData = null,
  provider = null,
}) {
  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    userQuery,
    languageHint,
    ragHits,
    sessionHistory,
    requireRag,
    stockData,
  });

  // Determine which provider to use
  const targetProvider = provider || config.primary;
  const providerMap = {
    openai: callOpenAI,
    gemini: callGemini,
    claude: callClaude,
    openrouter: callOpenRouter,
    deepseek: callDeepSeek,
  };

  console.log(`[LLM DEBUG] LLM_PROVIDER env: ${process.env.LLM_PROVIDER}`);
  console.log(`[LLM DEBUG] Config primary: ${config.primary}`);
  console.log(`[LLM DEBUG] Target provider: ${targetProvider}`);
  console.log(
    `[LLM DEBUG] Available providers: ${Object.keys(providerMap).join(", ")}`
  );

  try {
    // Try primary provider
    const providerFunc = providerMap[targetProvider];
    if (!providerFunc) {
      throw new Error(`Unknown provider: ${targetProvider}`);
    }

    console.log(`[LLM] Calling ${targetProvider}...`);
    const result = await providerFunc(systemPrompt);
    console.log(
      `[LLM] ✓ ${targetProvider} responded (${result.metadata.usage?.total_tokens || 0} tokens)`
    );

    return result;
  } catch (primaryError) {
    console.error(`[LLM] ✗ ${targetProvider} failed:`, primaryError.message);

    // Try fallback provider if configured
    if (config.fallback && config.fallback !== targetProvider) {
      try {
        console.log(`[LLM] Trying fallback: ${config.fallback}...`);
        const fallbackFunc = providerMap[config.fallback];
        const result = await fallbackFunc(systemPrompt);
        console.log(`[LLM] ✓ ${config.fallback} responded (fallback)`);

        return result;
      } catch (fallbackError) {
        console.error(
          `[LLM] ✗ Fallback ${config.fallback} also failed:`,
          fallbackError.message
        );
        throw new Error(
          `Both primary (${targetProvider}) and fallback (${config.fallback}) providers failed. ` +
            `Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`
        );
      }
    }

    // No fallback configured, throw primary error
    throw primaryError;
  }
}

/**
 * Get available providers and their status
 *
 * @returns {Object} Provider status
 */
export function getProviderStatus() {
  return {
    primary: config.primary,
    fallback: config.fallback,
    available: Object.entries(config.providers).reduce((acc, [name, conf]) => {
      acc[name] = !!conf.apiKey;
      return acc;
    }, {}),
  };
}

export default {
  callLLM,
  getProviderStatus,
};

// ============================================
// UNIT TEST EXAMPLES (run with Jest)
// ============================================
/**
 * Example usage:
 *
 * import { callLLM } from './llmAdapter.js';
 *
 * const response = await callLLM({
 *   userQuery: 'What are the loan eligibility criteria?',
 *   languageHint: 'en',
 *   ragHits: [
 *     {
 *       filename: '151.pdf',
 *       page_num: 4,
 *       text: 'Loan eligibility requires...',
 *       excerpt: 'Loan eligibility requires minimum age 21...',
 *       score: 0.85
 *     }
 *   ],
 *   sessionHistory: [],
 *   requireRag: true
 * });
 *
 * console.log(response.text);
 * console.log(response.rag_sources);
 * console.log(response.metadata.provider);
 */

/**
 * Test: Call LLM with RAG context
 *
 * async function testLLMWithRAG() {
 *   const response = await callLLM({
 *     userQuery: 'Tell me about fixed deposits',
 *     languageHint: 'en',
 *     ragHits: [
 *       { filename: '151.pdf', page_num: 3, excerpt: 'FD rates...', score: 0.9 }
 *     ],
 *     requireRag: true
 *   });
 *
 *   assert(response.text.length > 0);
 *   assert(response.language === 'en');
 *   assert(response.rag_sources.length > 0);
 *   assert(response.metadata.provider);
 * }
 */
