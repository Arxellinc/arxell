// STT Button - Verification Component for STT

import { useSTT } from './useSTT';

interface STTButtonProps {
  config?: {
    redemptionMs?: number;
    minSpeechMs?: number;
    maxSpeechFrames?: number;
  };
}

/**
 * STTButton - Simple verification component for STT functionality
 * 
 * Features:
 * - Mic toggle button (start/stop)
 * - Pulsing animated indicator when isSpeaking
 * - "Transcribing..." interim state
 * - Completed transcript display
 * - Status badge: idle | starting | listening | error
 * - Error message display
 */
export function STTButton({ config }: STTButtonProps) {
  const { 
    status, 
    transcript, 
    interimTranscript, 
    isSpeaking, 
    error,
    start, 
    stop 
  } = useSTT(config);

  const isActive = status === 'listening' || status === 'starting';

  const getStatusColor = () => {
    switch (status) {
      case 'idle': return '#888';
      case 'starting': return '#f59e0b';
      case 'listening': return '#10b981';
      case 'error': return '#ef4444';
      default: return '#888';
    }
  };

  return (
    <div style={{
      padding: '16px',
      border: '1px solid #ddd',
      borderRadius: '8px',
      maxWidth: '400px',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Header with status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Speech to Text</h3>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          padding: '4px 8px',
          borderRadius: '4px',
          backgroundColor: `${getStatusColor()}20`,
          color: getStatusColor(),
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(),
          }} />
          {status}
        </span>
      </div>

      {/* Mic button */}
      <button
        onClick={isActive ? stop : start}
        style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isActive ? '#ef4444' : '#3b82f6',
          color: 'white',
          fontSize: '24px',
          margin: '0 auto 16px',
          transition: 'all 0.2s',
          boxShadow: isSpeaking ? `0 0 0 0 rgba(239, 68, 68, 0.7)` : undefined,
          animation: isSpeaking ? 'pulse 1.5s infinite' : undefined,
        }}
      >
        {isActive ? '⏹' : '🎤'}
      </button>

      {/* Speaking indicator */}
      {isSpeaking && (
        <div style={{
          textAlign: 'center',
          color: '#ef4444',
          fontSize: '14px',
          marginBottom: '12px',
        }}>
          Speaking...
        </div>
      )}

      {/* Interim transcript */}
      {interimTranscript && (
        <div style={{
          textAlign: 'center',
          color: '#6b7280',
          fontSize: '14px',
          fontStyle: 'italic',
          marginBottom: '12px',
        }}>
          {interimTranscript}
        </div>
      )}

      {/* Final transcript */}
      {transcript && (
        <div style={{
          padding: '12px',
          backgroundColor: '#f3f4f6',
          borderRadius: '6px',
          fontSize: '14px',
          lineHeight: '1.5',
        }}>
          {transcript}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: '#fef2f2',
          borderRadius: '6px',
          fontSize: '14px',
          color: '#ef4444',
          marginTop: '12px',
        }}>
          Error: {error}
        </div>
      )}

      {/* Instructions */}
      {status === 'idle' && !error && (
        <p style={{
          textAlign: 'center',
          color: '#6b7280',
          fontSize: '12px',
          marginTop: '12px',
        }}>
          Click the microphone to start
        </p>
      )}

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
