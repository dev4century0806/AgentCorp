/** A steady pseudo-random 0..1 for point `i`, channel `k`: murmur3's finaliser, so neighbouring points do not line up. */
export function mix(i: number, k: number): number {
  let h = (Math.imul(i, 0x9e3779b1) + Math.imul(k, 0x7f4a7c15)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
