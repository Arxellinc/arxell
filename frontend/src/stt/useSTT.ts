// useSTT Hook - Main STT functionality using @ricky0123/vad-web

import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useAudioQueue } from './useAudioQueue';

// Import vad-web - library handles microphone capture and VAD internally
import { MicVAD } from '@ricky0123/vad-web';

export interface STTConfig {
  redemptionMs?: number;
  minSpeechMs?: number;
  maxSpeechFrames?: number;
}

export interface STTState {
  status: 'idle' | 'starting' | 'listening' | 'error';
  transcript: string;
  interimTranscript: string;
  isSpeaking: boolean;
  error: string | null;
}

export interface UseSTTReturn extends STTState {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface TranscriptPayload {
  text: string;
  is_final: boolean;
  utterance_id: string;
}

interface STTStatusPayload {
  status: string;
  message?: string;
}

interface PipelineErrorPayload {
  source: string;
  message: string;
  details?: string;
}

const DEFAULT_CONFIG: Required<STTConfig> = {
  redemptionMs: 300,
  minSpeechMs: 500,
  maxSpeechFrames: 30000,
};

/**
 * useSTT - Hook for Speech-to-Text functionality
 * 
 * Features:
 * - Starts/stops whisper.cpp server
 * - Uses @ricky0123/vad-web for microphone capture and VAD
 * - Sends PCM to backend for transcription
 * - Emits events for transcript results
 * - Barge-in support - stops audio queue when user speaks
 * - Clean shutdown on unmount
 */
export function useSTT(config?: STTConfig): UseSTTReturn {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  
  const [status, setStatus] = useState<STTState['status']>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const audioQueue = useAudioQueue();
  const vadRef = useRef<MicVAD | null>(null);
  const unlistenTranscriptRef = useRef<UnlistenFn | null>(null);
  const unlistenStatusRef = useRef<UnlistenFn | null>(null);
  const unlistenErrorRef = useRef<UnlistenFn | null>(null);

  // Set up event listeners
  useEffect(() => {
    const setupListeners = async () => {
      // Listen for transcript events
      unlistenTranscriptRef.current = await listen<TranscriptPayload>('stt://transcript', (event) => {
        setTranscript(event.payload.text);
        setInterimTranscript('');
        setStatus('listening');
      });

      // Listen for status events
      unlistenStatusRef.current = await listen<STTStatusPayload>('stt://status', (event) => {
        if (event.payload.status === 'starting') {
          setStatus('starting');
        } else if (event.payload.status === 'running') {
          setStatus('listening');
        } else if (event.payload.status === 'stopped') {
          setStatus('idle');
        } else if (event.payload.status === 'error') {
          setStatus('error');
          setError(event.payload.message || 'Unknown error');
        }
      });

      // Listen for error events
      unlistenErrorRef.current = await listen<PipelineErrorPayload>('pipeline://error', (event) => {
        if (event.payload.source === 'stt') {
          setError(event.payload.message);
          setStatus('error');
        }
      });
    };

    setupListeners();

    return () => {
      unlistenTranscriptRef.current?.();
      unlistenStatusRef.current?.();
      unlistenErrorRef.current?.();
    };
  }, []);

  // Start STT
  const start = useCallback(async () => {
    try {
      setError(null);
      
      // Start the whisper.cpp server
      await invoke('start_stt');
      setStatus('starting');
      
      // Initialize VAD with @ricky0123/vad-web
      // The library handles microphone capture and VAD internally
      const myVAD = await MicVAD.new({
        onSpeechStart: () => {
          setIsSpeaking(true);
          // Barge-in: stop audio queue when user starts speaking
          audioQueue.stop();
        },
        onSpeechEnd: async (audio: Float32Array) => {
          setIsSpeaking(false);
          // Send PCM to backend for transcription
          setInterimTranscript('Transcribing...');
          
          const utteranceId = crypto.randomUUID();
          
          try {
            await invoke('transcribe_chunk', {
              pcmSamples: Array.from(audio),
              utteranceId,
            });
          } catch (err) {
            console.error('Transcription error:', err);
            setError(String(err));
          }
        },
        // VAD configuration using FrameProcessorOptions
        redemptionMs: resolvedConfig.redemptionMs,
        minSpeechMs: resolvedConfig.minSpeechMs,
      });
      
      vadRef.current = myVAD;
      
      // Start VAD (this will request microphone access internally)
      await myVAD.start();
      
      setStatus('listening');
      
    } catch (err) {
      console.error('Failed to start STT:', err);
      setError(String(err));
      setStatus('error');
      
      // Clean up on error
      await stop();
    }
  }, [resolvedConfig, audioQueue]);

  // Stop STT
  const stop = useCallback(async () => {
    try {
      // Stop VAD
      if (vadRef.current) {
        await vadRef.current.destroy();
        vadRef.current = null;
      }
      
      // Stop the whisper.cpp server
      await invoke('stop_stt');
      
      setStatus('idle');
      setIsSpeaking(false);
      setInterimTranscript('');
      
    } catch (err) {
      console.error('Error stopping STT:', err);
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    status,
    transcript,
    interimTranscript,
    isSpeaking,
    error,
    start,
    stop,
  };
}
