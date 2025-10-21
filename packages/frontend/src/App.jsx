/**
 * Shankh.ai Main App Component
 *
 * Multilingual Financial Chatbot with:
 * - Text and voice input
 * - RAG-enhanced responses with citations
 * - Real-time audio playback
 * - Language switching (English/Hindi)
 */

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  Languages,
  AlertCircle,
  FileText,
  Loader,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import useStore from "./store/useStore";
import { AudioRecorder } from "./utils/audioRecorder";
import { sendTextMessage, sendAudioMessage } from "./utils/api";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000";

function App() {
  const {
    sessionId,
    initSession,
    messages,
    addMessage,
    isLoading,
    setLoading,
    error,
    setError,
    clearError,
    language,
    setLanguage,
    isRecording,
    setRecording,
    recordingDuration,
    setRecordingDuration,
    audioVolume,
    setAudioVolume,
    setSocket,
    setConnected,
  } = useStore();

  const [inputText, setInputText] = useState("");
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [currentAudio, setCurrentAudio] = useState(null);
  const recordingIntervalRef = useRef(null);
  const volumeIntervalRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Initialize session and WebSocket
  useEffect(() => {
    const sid = initSession();

    // Connect to WebSocket
    const socket = io(WS_URL, {
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      console.log("[WS] Connected");
      setConnected(true);
      socket.emit("join", sid);
    });

    socket.on("disconnect", () => {
      console.log("[WS] Disconnected");
      setConnected(false);
    });

    socket.on("joined", (data) => {
      console.log("[WS] Joined session:", data.sessionId);
    });

    socket.on("message", (data) => {
      console.log("[WS] Received message:", data);
      addMessage({
        role: "assistant",
        content: data.text,
        html: data.html_formatted,
        language: data.language,
        sources: data.rag_sources,
        followUp: data.follow_up_questions,
        audioUrl: data.tts_audio_url,
      });
      setLoading(false);
    });

    setSocket(socket);

    return () => {
      socket.disconnect();
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
      }
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle text message send
  const handleSendText = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage = inputText.trim();
    setInputText("");
    clearError();

    // Add user message
    addMessage({
      role: "user",
      content: userMessage,
    });

    setLoading(true);

    try {
      // Send message - response will come via WebSocket
      await sendTextMessage(sessionId, userMessage, language);

      // Don't add message here - WebSocket handler will do it
      // This prevents duplicate messages
    } catch (err) {
      console.error("[Chat] Send failed:", err);
      setError(
        err.response?.data?.details || err.message || "Failed to send message"
      );
      setLoading(false);
    }
  };

  // Handle voice recording
  const handleStartRecording = async () => {
    if (!AudioRecorder.isSupported()) {
      setError("Audio recording is not supported in your browser");
      return;
    }

    clearError();

    try {
      await audioRecorder.startRecording();
      setRecording(true);

      // Update duration
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(audioRecorder.getDuration());
      }, 100);

      // Update volume
      volumeIntervalRef.current = setInterval(() => {
        setAudioVolume(audioRecorder.getVolume());
      }, 50);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStopRecording = async () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current);
    }

    setRecording(false);
    setRecordingDuration(0);
    setAudioVolume(0);

    try {
      const { blob, duration } = await audioRecorder.stopRecording();

      console.log("[Audio] Recorded:", { size: blob.size, duration });

      // Add user message (will be updated with transcription)
      addMessage({
        role: "user",
        content: "🎤 Recording...",
        isTranscribing: true,
      });

      setLoading(true);

      // Send audio - response will come via WebSocket
      await sendAudioMessage(sessionId, blob, language);

      // WebSocket will handle the assistant response
      // This prevents duplicate messages
    } catch (err) {
      console.error("[Audio] Send failed:", err);
      setError(
        err.response?.data?.details || err.message || "Failed to send audio"
      );
      setLoading(false);
    }
  };

  // Handle follow-up question click
  const handleFollowUpClick = (question) => {
    setInputText(question);
  };

  // Play audio
  const handlePlayAudio = (url) => {
    if (currentAudio) {
      currentAudio.pause();
    }

    // Ensure URL is absolute
    const audioUrl = url.startsWith("http")
      ? url
      : `http://localhost:4000${url}`;

    const audio = new Audio(audioUrl);
    audio.play().catch((err) => {
      console.error("[Audio] Playback failed:", err);
      setError("Failed to play audio. The audio file may not be available.");
    });
    setCurrentAudio(audio);
  };

  // Toggle language
  const toggleLanguage = () => {
    setLanguage(language === "en" ? "hi" : "en");
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <span className="text-xl font-bold">श</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold">Shankh.ai</h1>
            <p className="text-xs text-gray-400">Financial Assistant</p>
          </div>
        </div>

        <button
          onClick={toggleLanguage}
          className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
          title="Switch Language"
        >
          <Languages className="w-4 h-4" />
          <span className="text-sm font-medium">
            {language === "en" ? "EN" : "हि"}
          </span>
        </button>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-700 px-4 py-2 flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-200">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="text-red-400 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              <span className="text-3xl">💬</span>
            </div>
            <h2 className="text-xl font-semibold mb-2">Welcome to Shankh.ai</h2>
            <p className="text-gray-400 max-w-md mx-auto">
              Ask me anything about financial services. You can type or use
              voice input.
              {language === "hi" && " हिंदी में भी पूछ सकते हैं।"}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <Message
            key={msg.id}
            message={msg}
            onFollowUpClick={handleFollowUpClick}
            onPlayAudio={handlePlayAudio}
          />
        ))}

        {isLoading && (
          <div className="flex items-center space-x-2 text-gray-400">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Recording Indicator */}
      {isRecording && (
        <div className="bg-red-900/30 border-t border-red-700 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium">
              Recording: {AudioRecorder.formatDuration(recordingDuration)}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-100"
                style={{ width: `${audioVolume}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="bg-gray-800 border-t border-gray-700 p-4">
        <div className="flex items-end space-x-2">
          <div className="flex-1 bg-gray-700 rounded-lg flex items-end">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
              placeholder={
                language === "en"
                  ? "Type your message..."
                  : "अपना संदेश टाइप करें..."
              }
              className="flex-1 bg-transparent px-4 py-3 outline-none resize-none max-h-32"
              rows={1}
              disabled={isLoading || isRecording}
            />
          </div>

          {!isRecording ? (
            <>
              <button
                onClick={handleSendText}
                disabled={!inputText.trim() || isLoading}
                className="p-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed transition"
                title="Send message"
              >
                <Send className="w-5 h-5" />
              </button>

              <button
                onClick={handleStartRecording}
                disabled={isLoading}
                className="p-3 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed transition"
                title="Record audio"
              >
                <Mic className="w-5 h-5" />
              </button>
            </>
          ) : (
            <button
              onClick={handleStopRecording}
              className="p-3 rounded-lg bg-red-600 hover:bg-red-700 transition"
              title="Stop recording"
            >
              <MicOff className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Message Component
function Message({ message, onFollowUpClick, onPlayAudio }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-2xl ${isUser ? "bg-blue-600" : "bg-gray-800"} rounded-lg p-4 space-y-3`}
      >
        {/* Message Content */}
        <div className="prose prose-invert prose-sm max-w-none">
          {message.html ? (
            <div dangerouslySetInnerHTML={{ __html: message.html }} />
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          )}
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-gray-700">
            <div className="flex items-center space-x-2 text-xs text-gray-400">
              <FileText className="w-3 h-3" />
              <span>Sources:</span>
            </div>
            {message.sources.map((source, idx) => (
              <div key={idx} className="text-xs bg-gray-900/50 rounded p-2">
                <div className="font-medium text-blue-400">
                  {source.filename} (p.{source.page_range})
                </div>
                <div className="text-gray-400 mt-1">{source.excerpt}</div>
              </div>
            ))}
          </div>
        )}

        {/* Audio Playback */}
        {message.audioUrl && (
          <button
            onClick={() => onPlayAudio(message.audioUrl)}
            className="flex items-center space-x-2 text-xs text-purple-400 hover:text-purple-300 transition"
          >
            <Volume2 className="w-4 h-4" />
            <span>Play audio</span>
          </button>
        )}

        {/* Follow-up Questions */}
        {message.followUp && message.followUp.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-xs text-gray-400">Suggestions:</div>
            <div className="flex flex-wrap gap-2">
              {message.followUp.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => onFollowUpClick(q)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 rounded px-3 py-1 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
