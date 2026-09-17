// Chunk residency for the streamed region.
//
// This module knows nothing about geometry or rendering. It answers one question — which
// chunks should exist right now, and at what detail — and drives two callbacks to make the
// world match that answer within a per-frame budget. Keeping it free of THREE means the
// invariants that actually matter (nothing built twice, nothing leaked, the budget
// respected) are testable without a GPU.

import { WORLD, chunkKey, chunkCentre, chunkInWorld } from './worldgen.js';

// Ring radii in chunks. The camera is a close top-down orthographic view, so the visible
// world is small: three rings reach 575 m past the far edge of the screen, which covers the
// shadow frustum and leaves a margin for fast flight.
export const LOD_RINGS = [1.6, 3.0, 4.6];

export function lodFor(distanceInChunks, rings = LOD_RINGS) {
  for (let i = 0; i < rings.length; i++) if (distanceInChunks <= rings[i]) return i;
  return -1;   // outside the streamed set
}

// The chunks that should be resident for a viewer at (x, z), nearest first.
export function desiredChunks(x, z, rings = LOD_RINGS) {
  const reach = Math.ceil(rings[rings.length - 1]);
  const px = x / WORLD.chunk, pz = z / WORLD.chunk;
  const cx0 = Math.floor(px), cz0 = Math.floor(pz);
  const out = [];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      if (!chunkInWorld(cx, cz)) continue;
      const centre = chunkCentre(cx, cz);
      const distance = Math.hypot(centre.x - x, centre.z - z) / WORLD.chunk;
      const lod = lodFor(distance, rings);
      if (lod < 0) continue;
      out.push({ cx, cz, lod, distance, key: chunkKey(cx, cz) });
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

export class ChunkStreamer {
  // build(cx, cz, lod) -> payload, called at most `budget` times per update.
  // dispose(payload, entry) -> void, called as soon as a chunk leaves or changes detail.
  constructor({ build, dispose, budget = 2, rings = LOD_RINGS } = {}) {
    this.build = build;
    this.disposeChunk = dispose;
    this.budget = budget;
    this.rings = rings;
    this.resident = new Map();      // key -> { cx, cz, lod, payload }
    this.queue = [];                // pending builds, nearest first
    this.stats = { built: 0, disposed: 0, rebuiltForLod: 0, queued: 0, peakResident: 0 };
  }

  // Reconciles the resident set with the viewer position. Returns what changed this call.
  update(x, z) {
    const wanted = desiredChunks(x, z, this.rings);
    const wantedByKey = new Map(wanted.map(entry => [entry.key, entry]));
    const removed = [];

    // Anything no longer wanted, or wanted at a different detail, goes now. Releasing
    // before building keeps the peak memory at one chunk rather than two rings.
    for (const [key, entry] of this.resident) {
      const want = wantedByKey.get(key);
      if (!want || want.lod !== entry.lod) {
        this.disposeChunk?.(entry.payload, entry);
        this.resident.delete(key);
        this.stats.disposed++;
        if (want) this.stats.rebuiltForLod++;
        removed.push(entry);
      }
    }

    // Rebuild the queue each update so it always reflects the current priorities; a chunk
    // that fell behind the viewer stops competing with one in front of it.
    this.queue = wanted.filter(entry => !this.resident.has(entry.key));
    this.stats.queued = this.queue.length;

    const built = [];
    const allowance = Math.min(this.budget, this.queue.length);
    for (let i = 0; i < allowance; i++) {
      const entry = this.queue[i];
      const payload = this.build?.(entry.cx, entry.cz, entry.lod);
      this.resident.set(entry.key, { cx: entry.cx, cz: entry.cz, lod: entry.lod, payload });
      this.stats.built++;
      built.push(entry);
    }
    this.queue = this.queue.slice(allowance);
    this.stats.peakResident = Math.max(this.stats.peakResident, this.resident.size);
    return { built, removed, pending: this.queue.length };
  }

  // Brings the world fully up to date regardless of budget. Used when entering the world
  // or teleporting, where a hitch is preferable to flying over unbuilt ground.
  settle(x, z, maxPasses = 400) {
    let passes = 0;
    while (passes++ < maxPasses) {
      const { pending } = this.update(x, z);
      if (!pending) break;
    }
    return this.resident.size;
  }

  has(cx, cz) { return this.resident.has(chunkKey(cx, cz)); }
  lodAt(cx, cz) { return this.resident.get(chunkKey(cx, cz))?.lod ?? -1; }

  clear() {
    for (const [, entry] of this.resident) { this.disposeChunk?.(entry.payload, entry); this.stats.disposed++; }
    this.resident.clear();
    this.queue = [];
  }
}
