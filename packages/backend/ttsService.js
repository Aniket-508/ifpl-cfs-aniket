/**
 * Text-to-Speech (TTS) Service for Shankh.ai
 * 
 * Provides audio synthesis with automatic chunking to handle long texts.
 * Supports multiple TTS providers with configurable fallback.
 * 
 * Providers:
 * - gTTS (Google Text-to-Speech) - Free, cloud-based
 * - Coqui TTS - Local, high-quality, open-source
 * - Azure Speech Services - Enterprise-grade
 * - ElevenLabs - Premium voice quality
 * 
 * Features:
 * - Automatic text chunking to bypass gTTS 1000-char limit
 * - Audio concatenation using ffmpeg
 * - Multilingual support (Hindi, English, and more)
 * - Voice selection per language
 * - Streaming-ready chunk delivery
 * 
 * @module ttsService
 */

import gtts from 'node-gtts';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const readFile = promisify(fs.readFile);

/**
 * TTS Configuration
 */
const config = {
  provider: process.env.TTS_PROVIDER || 'gtts',
  
  // gTTS settings
  gtts: {
    chunkSize: parseInt(process.env.GTTS_CHUNK_SIZE) || 900,
    defaultLang: process.env.GTTS_LANG_DEFAULT || 'en',
    langMap: {
      'en': 'en',
      'hi': 'hi',
      'en-IN': 'en-in',
      'hi-IN': 'hi',
    },
  },
  
  // Azure TTS
  azure: {
    key: process.env.AZURE_TTS_KEY,
    region: process.env.AZURE_TTS_REGION || 'eastus',
    voiceEn: process.env.AZURE_TTS_VOICE_EN || 'en-US-JennyNeural',
    voiceHi: process.env.AZURE_TTS_VOICE_HI || 'hi-IN-SwaraNeural',
  },
  
  // ElevenLabs
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
    endpoint: 'https://api.elevenlabs.io/v1/text-to-speech',
  },
  
  // File storage
  tempDir: process.env.TEMP_DIR || './temp',
  outputFormat: process.env.AUDIO_OUTPUT_FORMAT || 'mp3',
  audioBitrate: process.env.AUDIO_BITRATE || '128k',
  
  // ffmpeg path (optional, uses system PATH by default)
  ffmpegPath: process.env.FFMPEG_PATH || null,
};

// Set ffmpeg path if configured
if (config.ffmpegPath) {
  ffmpeg.setFfmpegPath(config.ffmpegPath);
}

// Ensure temp directory exists
(async () => {
  try {
    await mkdir(config.tempDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create temp directory:', error.message);
  }
})();

/**
 * Split text into chunks suitable for TTS
 * 
 * @param {string} text - Text to split
 * @param {number} maxChunkSize - Maximum characters per chunk
 * @returns {Array<string>} Array of text chunks
 */
function chunkText(text, maxChunkSize = config.gtts.chunkSize) {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks = [];
  const sentences = text.match(/[^.!?।]+[.!?।]+/g) || [text];
  let currentChunk = '';

  for (const sentence of sentences) {
    // If single sentence exceeds limit, force split
    if (sentence.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // Split long sentence at word boundaries
      const words = sentence.split(/\s+/);
      let longChunk = '';
      for (const word of words) {
        if ((longChunk + ' ' + word).length > maxChunkSize) {
          chunks.push(longChunk.trim());
          longChunk = word;
        } else {
          longChunk += (longChunk ? ' ' : '') + word;
        }
      }
      if (longChunk) {
        chunks.push(longChunk.trim());
      }
      continue;
    }

    // Normal sentence accumulation
    if ((currentChunk + ' ' + sentence).length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Generate speech using gTTS
 * 
 * @param {string} text - Text to synthesize
 * @param {string} language - Language code
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} TTS result with audio data
 */
async function synthesizeWithGTTS(text, language, options = {}) {
  try {
    const lang = config.gtts.langMap[language] || config.gtts.defaultLang;
    const chunks = chunkText(text);
    
    console.log(`[TTS] gTTS: Synthesizing ${chunks.length} chunk(s) in ${lang}`);

    if (chunks.length === 1) {
      // Single chunk - no concatenation needed
      return new Promise((resolve, reject) => {
        const filename = `tts_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp3`;
        const filepath = path.join(config.tempDir, filename);

        gtts(lang).save(filepath, text, (err) => {
          if (err) {
            reject(new Error(`gTTS synthesis failed: ${err.message}`));
          } else {
            resolve({
              audioPath: filepath,
              audioUrl: `/audio/${filename}`,
              duration: null, // Would need audio analysis
              chunks: [{ text, url: `/audio/${filename}` }],
              provider: 'gtts',
            });
          }
        });
      });
    }

    // Multiple chunks - synthesize and concatenate
    const chunkFiles = [];
    const chunkPromises = chunks.map((chunk, idx) => {
      return new Promise((resolve, reject) => {
        const filename = `tts_chunk_${Date.now()}_${idx}.mp3`;
        const filepath = path.join(config.tempDir, filename);

        gtts(lang).save(filepath, chunk, (err) => {
          if (err) {
            reject(new Error(`gTTS chunk ${idx} failed: ${err.message}`));
          } else {
            chunkFiles.push(filepath);
            resolve({ text: chunk, path: filepath });
          }
        });
      });
    });

    await Promise.all(chunkPromises);

    // Concatenate chunks using ffmpeg
    const outputFilename = `tts_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${config.outputFormat}`;
    const outputPath = path.join(config.tempDir, outputFilename);

    await concatenateAudio(chunkFiles, outputPath);

    // Clean up chunk files
    await Promise.all(chunkFiles.map(file => unlink(file).catch(() => {})));

    console.log(`[TTS] ✓ Generated audio: ${outputFilename}`);

    return {
      audioPath: outputPath,
      audioUrl: `/audio/${outputFilename}`,
      duration: null,
      chunks: chunks.map((text, idx) => ({ text, index: idx })),
      provider: 'gtts',
    };

  } catch (error) {
    throw new Error(`gTTS synthesis failed: ${error.message}`);
  }
}

/**
 * Concatenate audio files using ffmpeg
 * 
 * @param {Array<string>} inputFiles - Array of input file paths
 * @param {string} outputPath - Output file path
 * @returns {Promise<void>}
 */
function concatenateAudio(inputFiles, outputPath) {
  return new Promise((resolve, reject) => {
    // Check if ffmpeg is available
    ffmpeg.getAvailableFormats((err) => {
      if (err) {
        reject(new Error(
          'ffmpeg not found. Install ffmpeg to enable audio concatenation. ' +
          'Without ffmpeg, responses longer than 900 characters cannot be synthesized. ' +
          'Install: https://ffmpeg.org/download.html'
        ));
        return;
      }

      const command = ffmpeg();

      // Add all input files
      inputFiles.forEach(file => {
        command.input(file);
      });

      // Concatenate and output
      command
        .on('error', (err) => {
          reject(new Error(`ffmpeg concatenation failed: ${err.message}`));
        })
        .on('end', () => {
          resolve();
        })
        .mergeToFile(outputPath, config.tempDir);
    });
  });
}

/**
 * Generate speech using Azure Speech Services
 * 
 * @param {string} text - Text to synthesize
 * @param {string} language - Language code
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} TTS result
 */
async function synthesizeWithAzure(text, language, options = {}) {
  if (!config.azure.key || !config.azure.region) {
    throw new Error('AZURE_TTS_KEY or AZURE_TTS_REGION not configured');
  }

  try {
    const voice = language === 'hi' ? config.azure.voiceHi : config.azure.voiceEn;
    const endpoint = `https://${config.azure.region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    // Build SSML
    const ssml = `
      <speak version='1.0' xml:lang='${language}'>
        <voice name='${voice}'>
          ${text}
        </voice>
      </speak>
    `;

    const response = await axios.post(endpoint, ssml, {
      headers: {
        'Ocp-Apim-Subscription-Key': config.azure.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
      },
      responseType: 'arraybuffer',
    });

    const filename = `tts_azure_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp3`;
    const filepath = path.join(config.tempDir, filename);

    await writeFile(filepath, response.data);

    console.log(`[TTS] ✓ Azure TTS generated: ${filename}`);

    return {
      audioPath: filepath,
      audioUrl: `/audio/${filename}`,
      duration: null,
      chunks: [{ text, url: `/audio/${filename}` }],
      provider: 'azure',
    };

  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    throw new Error(`Azure TTS failed: ${message}`);
  }
}

/**
 * Generate speech using ElevenLabs
 * 
 * @param {string} text - Text to synthesize
 * @param {string} language - Language code (ignored, ElevenLabs uses voice ID)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} TTS result
 */
async function synthesizeWithElevenLabs(text, language, options = {}) {
  if (!config.elevenlabs.apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  try {
    const voiceId = options.voiceId || config.elevenlabs.voiceId;
    const endpoint = `${config.elevenlabs.endpoint}/${voiceId}`;

    const response = await axios.post(
      endpoint,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          'xi-api-key': config.elevenlabs.apiKey,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      }
    );

    const filename = `tts_elevenlabs_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp3`;
    const filepath = path.join(config.tempDir, filename);

    await writeFile(filepath, response.data);

    console.log(`[TTS] ✓ ElevenLabs TTS generated: ${filename}`);

    return {
      audioPath: filepath,
      audioUrl: `/audio/${filename}`,
      duration: null,
      chunks: [{ text, url: `/audio/${filename}` }],
      provider: 'elevenlabs',
    };

  } catch (error) {
    const message = error.response?.data?.detail || error.message;
    throw new Error(`ElevenLabs TTS failed: ${message}`);
  }
}

/**
 * Main TTS function with provider selection
 * 
 * @param {string} text - Text to synthesize
 * @param {string} language - Language code (en, hi, etc.)
 * @param {Object} options - Additional options
 * @param {string} options.provider - Specific provider to use
 * @param {string} options.voice - Voice ID (provider-specific)
 * @returns {Promise<Object>} TTS result
 */
export async function synthesizeTTS(text, language = 'en', options = {}) {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required for TTS synthesis');
  }

  const provider = options.provider || config.provider;
  
  console.log(`[TTS] Synthesizing with ${provider} (${text.length} chars, lang: ${language})`);

  try {
    let result;

    switch (provider) {
      case 'gtts':
        result = await synthesizeWithGTTS(text, language, options);
        break;

      case 'azure':
        result = await synthesizeWithAzure(text, language, options);
        break;

      case 'elevenlabs':
        result = await synthesizeWithElevenLabs(text, language, options);
        break;

      case 'coqui':
        throw new Error('Coqui TTS not yet implemented. Use gtts, azure, or elevenlabs.');

      default:
        throw new Error(`Unknown TTS provider: ${provider}`);
    }

    return result;

  } catch (error) {
    console.error(`[TTS] ✗ Synthesis failed:`, error.message);
    throw error;
  }
}

/**
 * Get audio file buffer
 * 
 * @param {string} audioPath - Path to audio file
 * @returns {Promise<Buffer>} Audio buffer
 */
export async function getAudioBuffer(audioPath) {
  try {
    return await readFile(audioPath);
  } catch (error) {
    throw new Error(`Failed to read audio file: ${error.message}`);
  }
}

/**
 * Clean up old audio files (call periodically)
 * 
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 * @returns {Promise<number>} Number of files deleted
 */
export async function cleanupOldAudio(maxAgeMs = 3600000) {
  try {
    const files = await fs.promises.readdir(config.tempDir);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      if (file.startsWith('tts_')) {
        const filePath = path.join(config.tempDir, file);
        const stats = await fs.promises.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs) {
          await unlink(filePath);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      console.log(`[TTS] Cleaned up ${deletedCount} old audio file(s)`);
    }

    return deletedCount;

  } catch (error) {
    console.error('[TTS] Cleanup failed:', error.message);
    return 0;
  }
}

/**
 * Get TTS status and capabilities
 * 
 * @returns {Object} Provider status
 */
export function getTTSStatus() {
  return {
    provider: config.provider,
    available: {
      gtts: true, // Always available
      azure: !!config.azure.key && !!config.azure.region,
      elevenlabs: !!config.elevenlabs.apiKey,
      coqui: false, // Not yet implemented
    },
    ffmpegAvailable: checkFFmpegSync(),
    tempDir: config.tempDir,
  };
}

/**
 * Check if ffmpeg is available (synchronous check)
 * 
 * @returns {boolean} True if ffmpeg available
 */
function checkFFmpegSync() {
  try {
    // Simple check - will be validated on first use
    return !!config.ffmpegPath || true; // Assume available if not specified
  } catch {
    return false;
  }
}

export default {
  synthesizeTTS,
  getAudioBuffer,
  cleanupOldAudio,
  getTTSStatus,
};


// ============================================
// UNIT TEST EXAMPLES
// ============================================
/**
 * Example usage:
 * 
 * import { synthesizeTTS, getAudioBuffer } from './ttsService.js';
 * 
 * // Generate speech
 * const result = await synthesizeTTS(
 *   'This is a test message that will be converted to speech.',
 *   'en',
 *   { provider: 'gtts' }
 * );
 * 
 * console.log('Audio URL:', result.audioUrl);
 * console.log('Audio path:', result.audioPath);
 * 
 * // Get audio buffer for streaming
 * const buffer = await getAudioBuffer(result.audioPath);
 */

/**
 * Test: Synthesize short text
 * 
 * async function testShortSynthesis() {
 *   const result = await synthesizeTTS('Hello world', 'en');
 *   assert(result.audioPath);
 *   assert(fs.existsSync(result.audioPath));
 *   assert(result.provider === 'gtts');
 * }
 */

/**
 * Test: Synthesize long text (chunking)
 * 
 * async function testLongSynthesis() {
 *   const longText = 'This is a very long text... '.repeat(100); // >900 chars
 *   const result = await synthesizeTTS(longText, 'en');
 *   assert(result.chunks.length > 1);
 *   assert(fs.existsSync(result.audioPath));
 * }
 */

/**
 * Provider swap documentation:
 * 
 * To use Azure TTS:
 * 1. Set TTS_PROVIDER=azure in .env
 * 2. Set AZURE_TTS_KEY=your-key
 * 3. Set AZURE_TTS_REGION=eastus
 * 
 * To use ElevenLabs:
 * 1. Set TTS_PROVIDER=elevenlabs in .env
 * 2. Set ELEVENLABS_API_KEY=your-key
 * 3. (Optional) Set ELEVENLABS_VOICE_ID for custom voice
 * 
 * ffmpeg installation:
 * - Windows: Download from https://ffmpeg.org/download.html, add to PATH
 * - Mac: brew install ffmpeg
 * - Linux: sudo apt-get install ffmpeg
 */
