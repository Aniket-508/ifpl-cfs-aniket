/**
 * Audio Recorder Utility
 * 
 * Provides Web Audio API based recording with:
 * - MediaRecorder for audio capture
 * - Blob creation for upload
 * - Volume visualization
 * - Error handling
 * 
 * @module audioRecorder
 */

/**
 * Audio Recorder Class
 */
export class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.maxDuration = parseInt(import.meta.env.VITE_MAX_RECORDING_DURATION) || 60000; // 60 seconds
  }

  /**
   * Initialize and start recording
   * @param {Object} options - Recording options
   * @param {string} options.mimeType - Audio MIME type
   * @param {number} options.audioBitsPerSecond - Audio bitrate
   * @returns {Promise<void>}
   */
  async startRecording(options = {}) {
    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      // Determine supported MIME type
      const mimeType = this.getSupportedMimeType(options.mimeType);

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: options.audioBitsPerSecond || 128000,
      });

      this.audioChunks = [];

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Handle stop
      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        this.isPaused = false;
      };

      // Handle errors
      this.mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
        this.stopRecording();
      };

      // Setup audio visualization
      this.setupVisualization();

      // Start recording
      this.mediaRecorder.start(100); // Collect data every 100ms
      this.isRecording = true;
      this.isPaused = false;
      this.startTime = Date.now();

      // Auto-stop after max duration
      setTimeout(() => {
        if (this.isRecording) {
          console.log('[AudioRecorder] Max duration reached, stopping...');
          this.stopRecording();
        }
      }, this.maxDuration);

      return { success: true };
    } catch (error) {
      console.error('[AudioRecorder] Failed to start recording:', error);
      throw new Error(this.getErrorMessage(error));
    }
  }

  /**
   * Setup audio visualization (volume meter)
   */
  setupVisualization() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      
      source.connect(this.analyser);
      this.analyser.fftSize = 256;
      
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
    } catch (error) {
      console.warn('[AudioRecorder] Visualization setup failed:', error);
    }
  }

  /**
   * Get current volume level (0-100)
   * @returns {number} Volume level
   */
  getVolume() {
    if (!this.analyser || !this.dataArray) {
      return 0;
    }

    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const average = sum / this.dataArray.length;
    
    // Normalize to 0-100
    return Math.min(100, (average / 255) * 200);
  }

  /**
   * Pause recording
   */
  pauseRecording() {
    if (this.mediaRecorder && this.isRecording && !this.isPaused) {
      this.mediaRecorder.pause();
      this.isPaused = true;
    }
  }

  /**
   * Resume recording
   */
  resumeRecording() {
    if (this.mediaRecorder && this.isRecording && this.isPaused) {
      this.mediaRecorder.resume();
      this.isPaused = false;
    }
  }

  /**
   * Stop recording and return audio blob
   * @returns {Promise<Blob>} Audio blob
   */
  async stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error('Recording not started'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        // Create blob from chunks
        const mimeType = this.mediaRecorder.mimeType;
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });

        // Calculate duration
        const duration = Date.now() - this.startTime;

        // Cleanup
        this.cleanup();

        resolve({
          blob: audioBlob,
          duration,
          mimeType,
          size: audioBlob.size,
        });
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel recording without returning blob
   */
  cancelRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.audioChunks = [];
      this.cleanup();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Stop all tracks
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mediaRecorder = null;
    this.analyser = null;
    this.dataArray = null;
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
  }

  /**
   * Get supported MIME type
   * @param {string} preferred - Preferred MIME type
   * @returns {string} Supported MIME type
   */
  getSupportedMimeType(preferred) {
    const types = [
      preferred,
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ].filter(Boolean);

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    // Fallback to default
    return '';
  }

  /**
   * Get user-friendly error message
   * @param {Error} error - Error object
   * @returns {string} Error message
   */
  getErrorMessage(error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Microphone permission denied. Please allow microphone access and try again.';
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No microphone found. Please connect a microphone and try again.';
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'Microphone is already in use by another application.';
    } else if (error.name === 'OverconstrainedError') {
      return 'Microphone does not meet required constraints.';
    } else if (error.name === 'TypeError') {
      return 'Browser does not support audio recording.';
    }
    return `Recording failed: ${error.message}`;
  }

  /**
   * Check if browser supports audio recording
   * @returns {boolean} True if supported
   */
  static isSupported() {
    return !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      window.MediaRecorder
    );
  }

  /**
   * Check if user has granted microphone permission
   * @returns {Promise<boolean>} True if granted
   */
  static async checkPermission() {
    try {
      if (!navigator.permissions) {
        return null; // Unknown
      }
      const result = await navigator.permissions.query({ name: 'microphone' });
      return result.state === 'granted';
    } catch {
      return null; // Unknown
    }
  }

  /**
   * Get recording duration
   * @returns {number} Duration in milliseconds
   */
  getDuration() {
    if (!this.isRecording || !this.startTime) {
      return 0;
    }
    return Date.now() - this.startTime;
  }

  /**
   * Format duration as MM:SS
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  static formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

/**
 * Create blob URL for audio playback
 * @param {Blob} blob - Audio blob
 * @returns {string} Blob URL
 */
export function createAudioURL(blob) {
  return URL.createObjectURL(blob);
}

/**
 * Revoke blob URL to free memory
 * @param {string} url - Blob URL
 */
export function revokeAudioURL(url) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert blob to base64 (for debugging/preview)
 * @param {Blob} blob - Audio blob
 * @returns {Promise<string>} Base64 string
 */
export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default AudioRecorder;
