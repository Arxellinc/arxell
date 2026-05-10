// Audio Echo Recorder with headphone microphone capture
class AudioEchoRecorder {
  constructor() {
    this.recordedAudio = null;
    this.recordingInterval = null;
    this.isRecording = false;
    this.isPlayingPlayback = false;
    this.playbackSpeed = 1.0; // Default playback speed
  }

  async startRecording() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create destination for recording from headphones
      const source = audioContext.createMediaStreamSource(audioContext.deviceId);
      
      // Connect to microphone capture device
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);

      // Start recording with a 20ms delay (like "tink tink" in your headphones)
      await new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve();
        }, 25);
      });

      this.recordedAudio = destination.stream.getAudioData();
      
      console.log('Recording started! Press SPACE to stop.');
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  }

  async pauseRecording() {
    if (!this.isRecording || !this.recordedAudio) return;
    
    try {
      audioContext.stop();
      
      // Create playback from recorded data with slight delay for natural echo effect
      const source = audioContext.createMediaStreamSource(this.recordedAudio);
      const destination = audioContext.createMediaStreamDestination();
      
      // Apply echo/reverb by playing at slightly slower speed (0.8x)
      this.playbackSpeed = 0.9;
      
      source.connect(destination);
      console.log('Recording paused.');
    } catch (error) {
      console.error('Error pausing recording:', error);
    }
  }

  stopRecording() {
    if (!this.isRecording || !this.recordedAudio) return;
    
    try {
      audioContext.stop();
      
      // Create playback from recorded data without delay (pure echo)
      const source = audioContext.createMediaStreamSource(this.recordedAudio);
      const destination = audioContext.createMediaStreamDestination();
      
      // Play at normal speed for direct echo effect
      this.playbackSpeed = 1.0;
      
      console.log('Recording stopped.');
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  }

  async playPlayback() {
    if (!this.recordedAudio) return;
    
    try {
      const source = audioContext.createMediaStreamSource(this.recordedAudio);
      
      // Create destination for playback with delay (echo effect)
      const destination = audioContext.createMediaStreamDestination();
      
      this.playbackSpeed = 0.95; // Slight echo/reverb
      
      // Connect and play
      source.connect(destination);
      console.log('Playback started!');
    } catch (error) {
      console.error('Error playing playback:', error);
    }
  }

  async stopPlayback() {
    if (!this.recordedAudio || !this.isPlayingPlayback) return;
    
    try {
      audioContext.stop();
      console.log('Playback stopped.');
    } catch (error) {
      console.error('Error stopping playback:', error);
    }
  }

  toggleRecording() {
    if (this.isRecording) {
      this.pauseRecording();
    } else {
      this.startRecording();
    }
  }

  updatePlaybackSpeed(speed) {
    this.playbackSpeed = speed;
    if (!this.isPlayingPlayback && this.recordedAudio) {
      // Pause playback and resume with new speed
      audioContext.stop();
      
      const source = audioContext.createMediaStreamSource(this.recordedAudio);
      const destination = audioContext.createMediaStreamDestination();
      
      source.connect(destination);
      console.log(`Playback speed updated to ${speed}`);
    } else if (this.isPlayingPlayback) {
      // Resume playback with new speed
      audioContext.resume();
      this.playbackSpeed = speed;
      const source = audioContext.createMediaStreamSource(this.recordedAudio);
      const destination = audioContext.createMediaStreamDestination();
      
      source.connect(destination);
    }
  }

  setDelay(ms) {
    // Add delay to playback effect
    this.playbackSpeed = ms / 1000;
    if (!this.isPlayingPlayback && this.recordedAudio) {
      audioContext.stop();
      
      const source = audioContext.createMediaStreamSource(this.recordedAudio);
      const destination = audioContext.createMediaStreamDestination();
      
      source.connect(destination);
      console.log(`Delay set to ${ms}ms`);
    } else if (this.isPlayingPlayback) {
      // Resume with new delay
      audioContext.resume();
      this.playbackSpeed = ms / 1000;
      const source = audioContext.createMediaStreamSource(this.recordedAudio);
      const destination = audioContext.createMediaStreamDestination();
      
      source.connect(destination);
    }
  }

  getRecordingData() {
    return this.recordedAudio || null;
  }
}

// Initialize the recorder module
export default new AudioEchoRecorder();
