// VAD Processor - Uses the bundled vad-web worklet for voice detection
// This registers as a simple passthrough - vad-web handles everything via its bundled worklet

class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferedSamples = [];
    this.sampleRate = 16000;
    this.inputSampleRate = 48000;
    
    this.port.onmessage = (e) => {
      if (e.data.type === 'config') {
        if (e.data.inputSampleRate) {
          this.inputSampleRate = e.data.inputSampleRate;
        }
      } else if (e.data.type === 'vad_init') {
        // Signal that we're ready - the bundled worklet handles VAD
        this.port.postMessage({ type: 'vad_ready' });
      }
    };
  }

  /**
   * Resample audio from input rate to target rate (16000 Hz)
   */
  resample(audioData, inputRate, outputRate) {
    if (inputRate === outputRate) return audioData;
    
    const ratio = inputRate / outputRate;
    const outputLength = Math.round(audioData.length / ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const inputIndex = i * ratio;
      const lowerIndex = Math.floor(inputIndex);
      const upperIndex = Math.min(lowerIndex + 1, audioData.length - 1);
      const fraction = inputIndex - lowerIndex;
      
      output[i] = audioData[lowerIndex] * (1 - fraction) + audioData[upperIndex] * fraction;
    }
    
    return output;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const inputData = input[0];
    if (!inputData) return true;
    
    // Resample to 16kHz
    const resampled = this.resample(inputData, this.inputSampleRate, this.sampleRate);
    
    // Add to buffer
    this.bufferedSamples.push(...resampled);

    // Send continuous audio frames for VAD processing
    // The main thread handles actual transcription based on VAD callbacks
    if (this.bufferedSamples.length >= this.sampleRate) {
      const audioToSend = this.bufferedSamples.slice(0, this.sampleRate);
      this.port.postMessage({ 
        type: 'audio_chunk', 
        pcm: audioToSend
      });
      this.bufferedSamples = this.bufferedSamples.slice(this.sampleRate);
    }

    return true;
  }
}

registerProcessor('vad-processor', VADProcessor);
