// Audio Queue Hook - TTS-ready playback queue
// This hook manages audio playback queue for future TTS integration

import { useRef, useCallback, useState } from 'react';

export interface UseAudioQueueReturn {
  enqueue: (chunk: Float32Array) => void;
  stop: () => void;
  isPlaying: boolean;
}

/**
 * Audio queue for TTS playback.
 * Currently unused by STT - built for future TTS integration.
 * 
 * Features:
 * - Uses Web Audio API AudioBufferSourceNode chain
 * - Plays chunks back-to-back with no gap
 * - 100ms jitter buffer to smooth chunk delivery variance
 * - stop() cancels all queued buffers immediately (barge-in)
 */
export function useAudioQueue(): UseAudioQueueReturn {
  const audioContextRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const jitterBufferRef = useRef<Float32Array[]>([]);

  // Initialize audio context on first use
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  // Play the next chunk in the queue
  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const ctx = getAudioContext();
    const chunk = queueRef.current.shift()!;
    
    // Create AudioBuffer
    const buffer = ctx.createBuffer(1, chunk.length, 16000); // 16kHz mono
    // @ts-expect-error - copyToChannel has strict typing that doesn't account for ArrayBufferLike
    buffer.copyToChannel(chunk, 0);
    
    // Create source node
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    currentSourceRef.current = source;
    
    source.onended = () => {
      currentSourceRef.current = null;
      playNext();
    };
    
    source.start();
  }, [getAudioContext]);

  // Enqueue a chunk for playback
  const enqueue = useCallback((chunk: Float32Array) => {
    queueRef.current.push(chunk);
    
    // If not playing, start
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      
      // Add small delay for jitter buffer
      setTimeout(() => playNext(), 100);
    }
  }, [playNext]);

  // Stop playback immediately (for barge-in)
  const stop = useCallback(() => {
    // Stop current playback
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Already stopped
      }
      currentSourceRef.current = null;
    }
    
    // Clear queue
    queueRef.current = [];
    jitterBufferRef.current = [];
    
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  return {
    enqueue,
    stop,
    isPlaying,
  };
}