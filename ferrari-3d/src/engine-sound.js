/**
 * A tiny procedural V8 voice built from Web Audio oscillators.
 * Flat-plane V8 = 4 firing pulses per crank revolution, so the
 * fundamental is rpm / 60 * 4. Layers: firing pulse (sawtooth),
 * sub-octave body (square), and filtered noise for intake rasp.
 */
export class EngineSound {
  constructor() {
    this.enabled = false;
    this.rpm = 1000;
  }

  init() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / curve.length) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6);
    }
    shaper.curve = curve;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;

    this.fire = ctx.createOscillator();
    this.fire.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    const fireGain = ctx.createGain();
    fireGain.gain.value = 0.5;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.25;

    // Combustion "lumpiness": amplitude-modulate the voice at crank frequency
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.35;
    const lumpy = ctx.createGain();
    lumpy.gain.value = 0.65;
    this.lfo.connect(lfoDepth).connect(lumpy.gain);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.Q.value = 1.2;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.05;

    this.fire.connect(fireGain).connect(lumpy);
    this.sub.connect(subGain).connect(lumpy);
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(lumpy);
    lumpy.connect(shaper).connect(this.filter).connect(this.master).connect(ctx.destination);

    [this.fire, this.sub, this.lfo, this.noise].forEach((n) => n.start());
    this.setRpm(this.rpm, 0);
  }

  toggle() {
    if (!this.ctx) this.init();
    this.enabled = !this.enabled;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.enabled ? 0.16 : 0, now, 0.25);
    return this.enabled;
  }

  setRpm(rpm, smoothing = 0.08) {
    this.rpm = rpm;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const f = (rpm / 60) * 4;
    this.fire.frequency.setTargetAtTime(f, now, smoothing);
    this.sub.frequency.setTargetAtTime(f / 2, now, smoothing);
    this.lfo.frequency.setTargetAtTime(rpm / 60, now, smoothing);
    this.filter.frequency.setTargetAtTime(400 + rpm * 0.55, now, smoothing);
    this.noiseFilter.frequency.setTargetAtTime(800 + rpm * 0.4, now, smoothing);
  }
}
