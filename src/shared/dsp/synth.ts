/** Tiny test-signal generator: a kick on every beat under a sustained chord. Used by tests and the browser demo. */
export function synthLoop(opts: { bpm: number; seconds: number; sampleRate: number; chordPcs?: number[]; kick?: boolean }): Float32Array {
  const { bpm, seconds, sampleRate, chordPcs = [], kick = true } = opts;
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  const beat = (60 / bpm) * sampleRate;
  if (kick) {
    for (let b = 0; b * beat < n; b++) {
      const start = Math.floor(b * beat);
      for (let i = 0; i < sampleRate * 0.12 && start + i < n; i++) {
        const t = i / sampleRate;
        const f = 50 + 110 * Math.exp(-t * 35);
        out[start + i] = out[start + i]! + 0.9 * Math.exp(-t * 28) * Math.sin(2 * Math.PI * f * t);
      }
    }
  }
  let prev = 0;
  for (const pc of chordPcs) {
    // Chord tones stack upward from the first one (root position); 48 is C3. A few harmonics, like a real instrument.
    let midi = 48 + pc;
    while (midi <= prev) midi += 12;
    prev = midi;
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    for (let h = 1; h <= 4; h++) {
      const amp = 0.12 / h;
      for (let i = 0; i < n; i++) out[i] = out[i]! + amp * Math.sin((2 * Math.PI * f0 * h * i) / sampleRate);
    }
  }
  return out;
}

/** Encode mono float samples as a 16 bit PCM WAV file. */
export function encodeWav(x: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i]!)) * 0x7fff, true);
  return buf;
}
