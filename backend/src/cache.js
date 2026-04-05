// Simple in-memory cache with TTL

class Cache {
  constructor(ttlMs = 5 * 60 * 1000) {
    this.store = new Map();
    this.ttl = ttlMs;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttl });
  }

  invalidate(key) {
    this.store.delete(key);
  }

  invalidatePrefix(prefix) {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  clear() {
    this.store.clear();
  }
}

// Shared cache instance (8-hour TTL for reference data)
const cache = new Cache(8 * 60 * 60 * 1000);

module.exports = cache;
