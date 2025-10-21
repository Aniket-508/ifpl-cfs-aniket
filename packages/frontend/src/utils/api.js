/**
 * API Client for Shankh.ai Backend
 */

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: API_URL,
  timeout: 60000, // 60 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Send text message
 */
export async function sendTextMessage(sessionId, text, language = 'en') {
  const response = await api.post('/chat/sendText', {
    sessionId,
    text,
    language,
  });
  return response.data;
}

/**
 * Send audio message
 */
export async function sendAudioMessage(sessionId, audioBlob, language = null) {
  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('audio', audioBlob, 'recording.webm');
  if (language) {
    formData.append('language', language);
  }

  const response = await api.post('/chat/sendAudio', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}

/**
 * Get conversation history
 */
export async function getHistory(sessionId) {
  const response = await api.get(`/chat/history/${sessionId}`);
  return response.data;
}

/**
 * Clear session
 */
export async function clearSession(sessionId) {
  const response = await api.delete(`/chat/session/${sessionId}`);
  return response.data;
}

/**
 * Get service status
 */
export async function getStatus() {
  const response = await api.get('/status');
  return response.data;
}

export default api;
