class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.framesWritten = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.framesWritten++] = channelData[i];
        
        if (this.framesWritten >= this.bufferSize) {
          // Send a copy of the buffer
          this.port.postMessage(new Float32Array(this.buffer));
          this.framesWritten = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('audio-recorder', AudioRecorderProcessor);
