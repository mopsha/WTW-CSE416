// Per-person candidate order. Spec: docs/design.md#pick-lifecycle (owner: Alan).
// Pure TypeScript: no Deno / React Native imports.

function hashSeed(...parts: string[]): number {
  // FNV-1a 32-bit over the joined parts; good enough entropy for a shuffle seed.
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

/** mulberry32: a small, fast, deterministic PRNG from a 32-bit integer seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically reorder a Pick's candidate ids for one caller.
 * Same (pickId, userId) always yields the same order (reopening the app
 * resumes at the same card); different users get different orders. Every id
 * in `candidateIds` appears exactly once in the result.
 */
export function shuffleForUser(
  candidateIds: readonly string[],
  pickId: string,
  userId: string,
): string[] {
  const result = [...candidateIds];
  const random = mulberry32(hashSeed(pickId, userId));
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
