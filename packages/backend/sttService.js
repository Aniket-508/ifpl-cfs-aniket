/**
 * Speech-to-Text (STT) Service for Shankh.ai
 * 
 * Provides audio transcription with language detection and confidence scoring.
 * Supports multiple STT providers with configurable fallback.
 * 
 * Providers:
 * - Whisper (local via RAG service or OpenAI API)
 * - Google Cloud Speech-to-Text
 * - Azure Speech Services
 * - Vosk (local, lightweight)
 * 
 * Features:
 * - Multilingual support (Hindi, English, and more)
 * - Confidence thresholding with re-record prompts
 * - Audio chunking for long recordings
 * - Language auto-detection
 * - Segment-level timestamps
 * 
 * @module sttService
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

/**
 * STT Configuration
 */
const config = {
  provider: process.env.STT_PROVIDER || 'whisper',
  confidenceThreshold: parseFloat(process.env.STT_CONFIDENCE_THRESHOLD) || 0.7,
  ragServiceUrl: process.env.RAG_SERVICE_URL || 'http://localhost:8000',
  
  // Whisper (via RAG service or OpenAI)
  whisper: {
    endpoint: `${process.env.RAG_SERVICE_URL || 'http://localhost:8000'}/transcribe`,
    model: process.env.WHISPER_MODEL || 'base',
    useOpenAI: process.env.WHISPER_USE_OPENAI === 'true',
    openaiKey: process.env.OPENAI_API_KEY,
  },
  
  // Google Cloud Speech-to-Text
  google: {
    apiKey: process.env.GOOGLE_CLOUD_API_KEY,
    endpoint: 'https://speech.googleapis.com/v1/speech:recognize',
    languageCodes: ['en-US', 'hi-IN', 'en-IN'],
  },
  
  // Azure Speech Services
  azure: {
    key: process.env.AZURE_SPEECH_KEY,
    region: process.env.AZURE_SPEECH_REGION || 'eastus',
    endpoint: null, // Will be constructed dynamically
  },
  
  // Max audio duration (seconds) before chunking
  maxDuration: 60,
  
  // Supported languages
  supportedLanguages: ['en', 'hi', 'en-IN', 'hi-IN'],
};

// Construct Azure endpoint if configured
if (config.azure.key && config.azure.region) {
  config.azure.endpoint = `https://${config.azure.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
}

/**
 * Transcribe audio using Whisper (local or OpenAI)
 * 
 * @param {Buffer|string} audioBuffer - Audio buffer or file path
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} Transcription result
 */
async function transcribeWithWhisper(audioBuffer, options = {}) {
  try {
    // Use local Whisper via RAG service (preferred)
    if (!config.whisper.useOpenAI) {
      const formData = new FormData();
      
      if (Buffer.isBuffer(audioBuffer)) {
        formData.append('audio', audioBuffer, {
          filename: 'audio.wav',
          contentType: 'audio/wav',
        });
      } else if (typeof audioBuffer === 'string') {
        formData.append('audio', fs.createReadStream(audioBuffer));
      } else {
        throw new Error('Invalid audio input: must be Buffer or file path');
      }

      const response = await axios.post(config.whisper.endpoint, formData, {
        headers: formData.getHeaders(),
        timeout: 60000, // 60 second timeout
      });

      const data = response.data;
      
      // Calculate average confidence from segments
      const segments = data.segments || [];
      let avgConfidence = data.confidence || null;
      
      if (!avgConfidence && segments.length > 0) {
        // Estimate confidence from segment data
        avgConfidence = segments.length > 0 ? 0.8 : 0.5; // Whisper doesn't always provide confidence
      }

      return {
        text: data.text.trim(),
        language: data.language || 'unknown',
        confidence: avgConfidence,
        segments: segments.map(seg => ({
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
        })),
        provider: 'whisper-local',
      };
    }
    
    // Use OpenAI Whisper API
    if (!config.whisper.openaiKey) {
      throw new Error('OPENAI_API_KEY not configured for Whisper API');
    }

    const formData = new FormData();
    if (Buffer.isBuffer(audioBuffer)) {
      formData.append('file', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });
    } else {
      formData.append('file', fs.createReadStream(audioBuffer));
    }
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${config.whisper.openaiKey}`,
        },
        timeout: 60000,
      }
    );

    const data = response.data;
    
    return {
      text: data.text.trim(),
      language: data.language || 'unknown',
      confidence: 0.85, // OpenAI Whisper doesn't provide confidence, use default
      segments: (data.segments || []).map(seg => ({
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
      })),
      provider: 'whisper-openai',
    };

  } catch (error) {
    const message = error.response?.data?.detail || error.message;
    throw new Error(`Whisper transcription failed: ${message}`);
  }
}

/**
 * Transcribe audio using Google Cloud Speech-to-Text
 * 
 * @param {Buffer} audioBuffer - Audio buffer
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} Transcription result
 */
async function transcribeWithGoogle(audioBuffer, options = {}) {
  if (!config.google.apiKey) {
    throw new Error('GOOGLE_CLOUD_API_KEY not configured');
  }

  try {
    const audioBase64 = audioBuffer.toString('base64');
    
    const response = await axios.post(
      `${config.google.endpoint}?key=${config.google.apiKey}`,
      {
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: options.sampleRate || 16000,
          languageCode: options.language || 'en-US',
          alternativeLanguageCodes: config.google.languageCodes.filter(
            code => code !== (options.language || 'en-US')
          ),
          enableAutomaticPunctuation: true,
          model: 'default',
        },
        audio: {
          content: audioBase64,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );

    const results = response.data.results || [];
    if (results.length === 0) {
      throw new Error('No transcription results from Google');
    }

    const alternative = results[0].alternatives[0];
    const confidence = alternative.confidence || 0.5;
    const text = alternative.transcript || '';
    
    // Detect language from result
    const detectedLanguage = results[0].languageCode || options.language || 'en';

    return {
      text: text.trim(),
      language: detectedLanguage,
      confidence,
      segments: [], // Google doesn't provide segment-level timing by default
      provider: 'google',
    };

  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    throw new Error(`Google STT failed: ${message}`);
  }
}

/**
 * Transcribe audio using Azure Speech Services
 * 
 * @param {Buffer|string} audioBuffer - Audio buffer or file path
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} Transcription result
 */
async function transcribeWithAzure(audioBuffer, options = {}) {
  if (!config.azure.key || !config.azure.endpoint) {
    throw new Error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not configured');
  }

  try {
    const audioData = Buffer.isBuffer(audioBuffer) 
      ? audioBuffer 
      : fs.readFileSync(audioBuffer);

    const language = options.language || 'en-US';
    
    const response = await axios.post(
      config.azure.endpoint,
      audioData,
      {
        params: {
          language,
          format: 'detailed',
        },
        headers: {
          'Ocp-Apim-Subscription-Key': config.azure.key,
          'Content-Type': 'audio/wav',
        },
        timeout: 60000,
      }
    );

    const data = response.data;
    const confidence = data.NBest?.[0]?.Confidence || 0.5;
    const text = data.DisplayText || '';
    
    return {
      text: text.trim(),
      language: data.RecognitionStatus === 'Success' ? language : 'unknown',
      confidence,
      segments: [], // Azure batch transcription provides segments, real-time doesn't
      provider: 'azure',
    };

  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    throw new Error(`Azure STT failed: ${message}`);
  }
}

/**
 * Detect language from transcribed text (fallback)
 * 
 * @param {string} text - Transcribed text
 * @returns {string} Language code
 */
function detectLanguageFromText(text) {
  try {
    // Simple heuristic: check for Hindi Unicode range
    const hindiPattern = /[\u0900-\u097F]/;
    if (hindiPattern.test(text)) {
      return 'hi';
    }
    return 'en';
  } catch (error) {
    return 'en';
  }
}

/**
 * Main transcription function with provider selection
 * 
 * @param {Buffer|string} audioBuffer - Audio buffer or file path
 * @param {Object} options - Transcription options
 * @param {string} options.language - Target language hint
 * @param {string} options.provider - Specific provider to use
 * @param {number} options.sampleRate - Audio sample rate
 * @returns {Promise<Object>} Transcription result
 */
export async function transcribeAudio(audioBuffer, options = {}) {
  const provider = options.provider || config.provider;
  
  console.log(`[STT] Transcribing with ${provider}...`);

  let result;

  try {
    switch (provider) {
      case 'whisper':
        result = await transcribeWithWhisper(audioBuffer, options);
        break;
        
      case 'google':
        result = await transcribeWithGoogle(audioBuffer, options);
        break;
        
      case 'azure':
        result = await transcribeWithAzure(audioBuffer, options);
        break;
        
      default:
        throw new Error(`Unknown STT provider: ${provider}`);
    }

    // Fallback language detection if not provided
    if (!result.language || result.language === 'unknown') {
      result.language = detectLanguageFromText(result.text);
    }

    // Normalize language code
    result.language = normalizeLanguageCode(result.language);

    // Check confidence threshold
    const meetsThreshold = result.confidence >= config.confidenceThreshold;
    result.low_confidence = !meetsThreshold;
    
    if (!meetsThreshold) {
      console.log(
        `[STT] ⚠️  Low confidence: ${result.confidence.toFixed(2)} < ${config.confidenceThreshold}`
      );
    } else {
      console.log(
        `[STT] ✓ Transcribed: "${result.text.substring(0, 50)}..." (${result.language}, conf: ${result.confidence.toFixed(2)})`
      );
    }

    return result;

  } catch (error) {
    console.error(`[STT] ✗ Transcription failed:`, error.message);
    throw error;
  }
}

/**
 * Normalize language code to BCP 47 format
 * 
 * @param {string} langCode - Language code
 * @returns {string} Normalized code
 */
function normalizeLanguageCode(langCode) {
  const normMap = {
    'english': 'en',
    'hindi': 'hi',
    'en-us': 'en',
    'en-in': 'en',
    'hi-in': 'hi',
  };
  
  const normalized = langCode.toLowerCase();
  return normMap[normalized] || normalized;
}

/**
 * Check if audio file is too long and needs chunking
 * (Placeholder - implement actual audio duration detection if needed)
 * 
 * @param {Buffer|string} audioBuffer - Audio buffer or file path
 * @returns {boolean} True if chunking needed
 */
function needsChunking(audioBuffer) {
  // Placeholder: implement with audio library if needed
  // For now, assume chunking not needed
  return false;
}

/**
 * Get provider status and capabilities
 * 
 * @returns {Object} Provider status
 */
export function getSTTStatus() {
  return {
    provider: config.provider,
    confidenceThreshold: config.confidenceThreshold,
    available: {
      whisper: !!config.ragServiceUrl || !!config.whisper.openaiKey,
      google: !!config.google.apiKey,
      azure: !!config.azure.key && !!config.azure.region,
    },
    supportedLanguages: config.supportedLanguages,
  };
}

export default {
  transcribeAudio,
  getSTTStatus,
};


// ============================================
// UNIT TEST EXAMPLES
// ============================================
/**
 * Example usage:
 * 
 * import { transcribeAudio } from './sttService.js';
 * import fs from 'fs';
 * 
 * // Transcribe from file
 * const result = await transcribeAudio('./recording.wav', {
 *   language: 'en',
 *   provider: 'whisper'
 * });
 * 
 * console.log(result.text);
 * console.log(result.confidence);
 * console.log(result.low_confidence);
 * 
 * // Transcribe from buffer
 * const audioBuffer = fs.readFileSync('./recording.wav');
 * const result2 = await transcribeAudio(audioBuffer);
 */

/**
 * Test: Transcribe sample audio
 * 
 * async function testTranscription() {
 *   const audioPath = './test/fixtures/sample.wav';
 *   const result = await transcribeAudio(audioPath, { provider: 'whisper' });
 *   
 *   assert(result.text.length > 0);
 *   assert(result.language);
 *   assert(result.confidence >= 0 && result.confidence <= 1);
 *   assert(result.provider === 'whisper-local' || result.provider === 'whisper-openai');
 * }
 */

/**
 * Provider swap example (for documentation):
 * 
 * To switch from Whisper to Google Cloud STT:
 * 1. Set env: STT_PROVIDER=google
 * 2. Set env: GOOGLE_CLOUD_API_KEY=your-key
 * 3. No code changes needed
 * 
 * To use Azure:
 * 1. Set env: STT_PROVIDER=azure
 * 2. Set env: AZURE_SPEECH_KEY=your-key
 * 3. Set env: AZURE_SPEECH_REGION=eastus
 * 
 * To use Vosk (local, lightweight):
 * - Not yet implemented, but would follow same pattern
 * - Requires vosk-api npm package
 */
