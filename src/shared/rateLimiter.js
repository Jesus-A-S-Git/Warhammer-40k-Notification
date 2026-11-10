// Per-host token-bucket rate limiter with a concurrency cap.
//
// Every outbound request in this app MUST go through `politeFetch` (see
// httpClient.js), which uses one RateLimiter per host. Limits are
// deliberately conservative: we are a guest on retailers' servers.

export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.requestsPerMinute  sustained rate
   * @param {number} [opts.burst=1]          bucket size (max back-to-back requests)
   * @param {number} [opts.maxConcurrent=1]  simultaneous in-flight requests
   * @param {() => number} [opts.now]        injectable clock (ms) for tests
   * @param {(ms:number) => Promise<void>} [opts.sleep] injectable sleep for tests
   */
  constructor({ requestsPerMinute, burst = 1, maxConcurrent = 1, now = Date.now, sleep } = {}) {
    if (!(requestsPerMinute > 0)) throw new Error('requestsPerMinute must be > 0');
    this.intervalMs = 60_000 / requestsPerMinute;
    this.capacity = burst;
    this.tokens = burst;
    this.maxConcurrent = maxConcurrent;
    this.inFlight = 0;
    this.now = now;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.lastRefill = now();
    this.blockedUntil = 0; // set by penalize() after a 429/503
    this.queue = Promise.resolve();
  }

  #refill() {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed / this.intervalMs);
      this.lastRefill = t;
    }
  }

  /** Server told us to back off (429 / Retry-After). Pause this host. */
  penalize(ms) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
    this.tokens = 0;
  }

  /** Run `fn` once a token and a concurrency slot are available. FIFO. */
  schedule(fn) {
    const run = this.queue.then(async () => {
      for (;;) {
        const t = this.now();
        if (t < this.blockedUntil) { await this.sleep(this.blockedUntil - t); continue; }
        this.#refill();
        if (this.tokens >= 1 && this.inFlight < this.maxConcurrent) break;
        const waitForToken = this.tokens >= 1 ? 25 : (1 - this.tokens) * this.intervalMs;
        await this.sleep(Math.ceil(waitForToken));
      }
      this.tokens -= 1;
      this.inFlight += 1;
    });
    // The queue only serialises *admission*; execution may overlap up to maxConcurrent.
    this.queue = run.catch(() => {});
    return run.then(async () => {
      try { return await fn(); } finally { this.inFlight -= 1; }
    });
  }
}
