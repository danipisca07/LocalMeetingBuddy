/**
 * Online speaker clustering over voice embeddings: each utterance is assigned
 * to the closest known speaker centroid (cosine similarity), or to a new
 * incremental speaker id when nothing is close enough. Mirrors Deepgram's
 * per-connection speaker numbering (0, 1, 2, ...).
 */
export class SpeakerClusterer {
  private centroids: Float32Array[] = [];
  private counts: number[] = [];
  private lastSpeaker = 0;
  private readonly threshold: number;

  constructor(threshold = Number(process.env.LOCAL_SPEAKER_THRESHOLD || 0.55)) {
    this.threshold = threshold;
  }

  /**
   * Assigns a speaker id to the given embedding and updates that speaker's
   * centroid with a running mean. Returns the previous speaker when the
   * embedding is missing/unreliable (e.g. segment too short).
   */
  assign(embedding: Float32Array | null): number {
    if (!embedding || embedding.length === 0) return this.lastSpeaker;

    let bestIdx = -1;
    let bestSim = -Infinity;
    for (let i = 0; i < this.centroids.length; i++) {
      const sim = cosineSimilarity(this.centroids[i], embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestSim >= this.threshold) {
      const centroid = this.centroids[bestIdx];
      const n = ++this.counts[bestIdx];
      for (let i = 0; i < centroid.length; i++) {
        centroid[i] += (embedding[i] - centroid[i]) / n;
      }
      this.lastSpeaker = bestIdx;
      return bestIdx;
    }

    this.centroids.push(Float32Array.from(embedding));
    this.counts.push(1);
    this.lastSpeaker = this.centroids.length - 1;
    return this.lastSpeaker;
  }

  reset(): void {
    this.centroids = [];
    this.counts = [];
    this.lastSpeaker = 0;
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
