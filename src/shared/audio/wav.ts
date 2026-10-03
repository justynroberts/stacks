/** Planar float audio: one Float32Array per channel, all the same length. */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export interface WavFormat {
  bits: 16 | 24 | 32;
  float: boolean;
}

export interface WavFile extends PcmAudio {
  format: WavFormat;
}

export const frameCount = (a: PcmAudio): number => a.channels[0]?.length ?? 0;

const tag = (v: DataView, o: number): string =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

/**
 * Reads PCM (8/16/24/32 bit) and IEEE float (32/64 bit) WAV, including WAVE_FORMAT_EXTENSIBLE, at its own sample
 * rate. Returns null for anything else (compressed WAV, truncated headers) so the caller can fall back to Web Audio.
 */
export function readWav(buf: ArrayBuffer): WavFile | null {
  if (buf.byteLength < 12) return null;
  const v = new DataView(buf);
  if (tag(v, 0) !== 'RIFF' || tag(v, 8) !== 'WAVE') return null;

  let fmt: { code: number; ch: number; sr: number; bits: number } | null = null;
  let data: { off: number; len: number } | null = null;
  for (let o = 12; o + 8 <= buf.byteLength; ) {
    const id = tag(v, o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ' && body + 16 <= buf.byteLength) {
      let code = v.getUint16(body, true);
      // Extensible: the real format code is the first two bytes of the sub-format GUID.
      if (code === 0xfffe && size >= 26 && body + 26 <= buf.byteLength) code = v.getUint16(body + 24, true);
      fmt = { code, ch: v.getUint16(body + 2, true), sr: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      // Streamed files can carry a bogus size; never read past the buffer.
      data = { off: body, len: Math.min(size, buf.byteLength - body) };
      break;
    }
    o = body + size + (size & 1);
  }
  if (!fmt || !data || fmt.ch < 1 || fmt.sr < 1) return null;

  const float = fmt.code === 3;
  if (!(fmt.code === 1 || float)) return null;
  if (float ? fmt.bits !== 32 && fmt.bits !== 64 : ![8, 16, 24, 32].includes(fmt.bits)) return null;

  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.len / (bytes * fmt.ch));
  const channels = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
  let o = data.off;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.ch; c++) {
      let s: number;
      if (float) s = fmt.bits === 32 ? v.getFloat32(o, true) : v.getFloat64(o, true);
      else if (fmt.bits === 8) s = (v.getUint8(o) - 128) / 128;
      else if (fmt.bits === 16) s = v.getInt16(o, true) / 32768;
      else if (fmt.bits === 24) s = (((v.getUint8(o + 2) << 24) | (v.getUint8(o + 1) << 16) | (v.getUint8(o) << 8)) >> 8) / 8388608;
      else s = v.getInt32(o, true) / 2147483648;
      channels[c]![i] = s;
      o += bytes;
    }
  }
  const format: WavFormat = float ? { bits: 32, float: true } : { bits: fmt.bits === 8 ? 16 : (fmt.bits as 16 | 24 | 32), float: false };
  return { sampleRate: fmt.sr, channels, format };
}

/** Interleaved WAV at the given format. Integer formats are clamped, never wrapped. */
export function writeWav(a: PcmAudio, format: WavFormat): ArrayBuffer {
  const ch = a.channels.length;
  const frames = frameCount(a);
  const bytes = format.bits / 8;
  const dataLen = frames * ch * bytes;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, format.float ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, a.sampleRate, true);
  v.setUint32(28, a.sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, format.bits, true);
  w(36, 'data'); v.setUint32(40, dataLen, true);

  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = a.channels[c]![i]!;
      if (format.float) v.setFloat32(o, s, true);
      else {
        const x = Math.max(-1, Math.min(1, s));
        if (format.bits === 16) v.setInt16(o, Math.round(x * 32767), true);
        else if (format.bits === 24) {
          const n = Math.round(x * 8388607);
          v.setUint8(o, n & 0xff); v.setUint8(o + 1, (n >> 8) & 0xff); v.setUint8(o + 2, (n >> 16) & 0xff);
        } else v.setInt32(o, Math.round(x * 2147483647), true);
      }
      o += bytes;
    }
  }
  return buf;
}

/** IEEE 754 80-bit extended, as AIFF stores its sample rate. */
function extended80(v: DataView, o: number): number {
  const exp = ((v.getUint8(o) & 0x7f) << 8) | v.getUint8(o + 1);
  const mant = v.getUint32(o + 2) * 2 ** 32 + v.getUint32(o + 6);
  return exp === 0 && mant === 0 ? 0 : mant * 2 ** (exp - 16383 - 63);
}

/**
 * The file's own sample rate, read from its header, so Web Audio can decode without resampling. Null when the
 * format does not say cheaply (MP3, Ogg, M4A); the caller then picks a common rate.
 */
export function sniffSampleRate(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 12) return null;
  const v = new DataView(buf);
  const head = tag(v, 0);
  if (head === 'RIFF' && tag(v, 8) === 'WAVE') {
    for (let o = 12; o + 8 <= buf.byteLength; ) {
      const size = v.getUint32(o + 4, true);
      if (tag(v, o) === 'fmt ' && o + 16 <= buf.byteLength) return v.getUint32(o + 12, true) || null;
      o += 8 + size + (size & 1);
    }
    return null;
  }
  if (head === 'FORM' && (tag(v, 8) === 'AIFF' || tag(v, 8) === 'AIFC')) {
    for (let o = 12; o + 8 <= buf.byteLength; ) {
      const size = v.getUint32(o + 4);
      if (tag(v, o) === 'COMM' && o + 26 <= buf.byteLength) return Math.round(extended80(v, o + 16)) || null;
      o += 8 + size + (size & 1);
    }
    return null;
  }
  if (head === 'fLaC' && buf.byteLength >= 22) {
    // STREAMINFO is always the first metadata block; the rate is 20 bits starting 10 bytes in.
    const b = 8 + 10;
    return ((v.getUint8(b) << 12) | (v.getUint8(b + 1) << 4) | (v.getUint8(b + 2) >> 4)) || null;
  }
  return null;
}
