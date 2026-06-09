const { describe, it } = require('node:test');
const assert = require('node:assert');

const { SpeakerClusterer, cosineSimilarity } = require('../src/transcription/local/SpeakerClusterer.ts');

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = Float32Array.from([0.5, 0.3, -0.2]);
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([0, 1]);
    assert.strictEqual(cosineSimilarity(a, b), 0);
  });

  it('returns 0 for zero vectors', () => {
    const a = Float32Array.from([0, 0]);
    const b = Float32Array.from([1, 1]);
    assert.strictEqual(cosineSimilarity(a, b), 0);
  });
});

describe('SpeakerClusterer', () => {
  it('assigns speaker 0 to the first utterance', () => {
    const clusterer = new SpeakerClusterer(0.55);
    assert.strictEqual(clusterer.assign(Float32Array.from([1, 0, 0])), 0);
  });

  it('assigns the same speaker to similar embeddings', () => {
    const clusterer = new SpeakerClusterer(0.55);
    const a = clusterer.assign(Float32Array.from([1, 0.1, 0]));
    const b = clusterer.assign(Float32Array.from([0.9, 0.05, 0.01]));
    assert.strictEqual(a, b);
  });

  it('assigns a new speaker to a dissimilar embedding', () => {
    const clusterer = new SpeakerClusterer(0.55);
    const a = clusterer.assign(Float32Array.from([1, 0, 0]));
    const b = clusterer.assign(Float32Array.from([0, 1, 0]));
    assert.strictEqual(a, 0);
    assert.strictEqual(b, 1);
  });

  it('reuses the previous speaker when the embedding is missing', () => {
    const clusterer = new SpeakerClusterer(0.55);
    clusterer.assign(Float32Array.from([1, 0, 0]));
    clusterer.assign(Float32Array.from([0, 1, 0])); // speaker 1
    assert.strictEqual(clusterer.assign(null), 1);
  });

  it('keeps speaker ids stable across alternating speakers', () => {
    const clusterer = new SpeakerClusterer(0.55);
    const spkA = Float32Array.from([1, 0, 0]);
    const spkB = Float32Array.from([0, 1, 0]);
    assert.strictEqual(clusterer.assign(spkA), 0);
    assert.strictEqual(clusterer.assign(spkB), 1);
    assert.strictEqual(clusterer.assign(spkA), 0);
    assert.strictEqual(clusterer.assign(spkB), 1);
  });

  it('reset() clears all known speakers', () => {
    const clusterer = new SpeakerClusterer(0.55);
    clusterer.assign(Float32Array.from([0, 1, 0]));
    clusterer.reset();
    assert.strictEqual(clusterer.assign(Float32Array.from([1, 0, 0])), 0);
  });
});
