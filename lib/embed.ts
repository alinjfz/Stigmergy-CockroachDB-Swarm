import { EMBEDDING_DIMS } from "./config";

/** FNV-1a */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 384-d local embedding (MiniLM width) via character n-grams.
 * Similar phrases ("jammed aisle C") sit closer than unrelated ones.
 * Deterministic — tests and Cockroach C-SPANN share the same space.
 */
export function embedText(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIMS);
  const normed = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (normed.trim().length === 0) {
    vec[0] = 1;
    return Array.from(vec);
  }
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= normed.length - n; i++) {
      const gram = normed.slice(i, i + n);
      const h = hash32(gram);
      const idx = h % EMBEDDING_DIMS;
      const sign = h & 1 ? 1 : -1;
      vec[idx] += sign / n;
    }
  }
  let mag = 0;
  for (let i = 0; i < vec.length; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag) || 1;
  const out = new Array<number>(EMBEDDING_DIMS);
  for (let i = 0; i < EMBEDDING_DIMS; i++) out[i] = vec[i] / mag;
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function embeddingLiteral(vec: number[]): string {
  return `[${vec.map((v) => (Number.isFinite(v) ? v.toFixed(8) : "0")).join(",")}]`;
}
