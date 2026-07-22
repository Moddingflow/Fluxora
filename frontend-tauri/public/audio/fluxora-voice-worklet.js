class FluxoraVoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (input?.length) {
      const pcm = new Float32Array(input);
      this.port.postMessage(pcm, [pcm.buffer]);
      if (output) output.fill(0);
    }
    return true;
  }
}

registerProcessor('fluxora-voice-capture', FluxoraVoiceCaptureProcessor);
