/**
 * Zustand Store for App State
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

const useStore = create((set, get) => ({
  // Session
  sessionId: null,
  
  // Messages
  messages: [],
  
  // UI State
  isLoading: false,
  error: null,
  language: 'en',
  
  // Audio
  isRecording: false,
  recordingDuration: 0,
  audioVolume: 0,
  
  // WebSocket
  socket: null,
  isConnected: false,
  
  // Actions
  initSession: () => {
    const sessionId = uuidv4();
    set({ sessionId });
    return sessionId;
  },
  
  setSocket: (socket) => set({ socket }),
  
  setConnected: (isConnected) => set({ isConnected }),
  
  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, {
        ...message,
        id: message.id || uuidv4(),
        timestamp: message.timestamp || Date.now(),
      }],
    }));
  },
  
  updateLastMessage: (updates) => {
    set((state) => ({
      messages: state.messages.map((msg, idx) =>
        idx === state.messages.length - 1 ? { ...msg, ...updates } : msg
      ),
    }));
  },
  
  clearMessages: () => set({ messages: [] }),
  
  setLoading: (isLoading) => set({ isLoading }),
  
  setError: (error) => set({ error }),
  
  clearError: () => set({ error: null }),
  
  setLanguage: (language) => set({ language }),
  
  setRecording: (isRecording) => set({ isRecording }),
  
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  
  setAudioVolume: (audioVolume) => set({ audioVolume }),
}));

export default useStore;
