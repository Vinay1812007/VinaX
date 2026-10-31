/**
 * VinaX AI Live voice — the microphone tap. Runs in the audio thread and
 * hands the page the raw samples in ~85 ms batches; the page turns them into
 * 16 kHz 16-bit PCM for Gemini Live (live/liveAudio.ts). Loaded with
 * audioWorklet.addModule() from this same origin (the app's CSP has no blob:
 * scripts).
 */
class VinaxMicTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i += 1) {
        this.buf[this.n] = ch[i];
        this.n += 1;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('vinax-mic-tap', VinaxMicTap);
