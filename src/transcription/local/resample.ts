/** Converts 16-bit signed little-endian PCM to Float32 samples in [-1, 1]. */
export function int16BufferToFloat32(buffer: Buffer): Float32Array {
  const sampleCount = Math.floor(buffer.length / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buffer.readInt16LE(i * 2) / 32768;
  }
  return out;
}

/** Linear-interpolation resampler; good enough for speech models at 16 kHz. */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return samples;
  const outLength = Math.floor((samples.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx];
    const b = idx + 1 < samples.length ? samples[idx + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
