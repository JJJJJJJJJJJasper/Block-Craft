// ============================================================================
// A small pool of Web Workers with a priority queue of jobs.
// Jobs closer to the player run first (lower priority number = sooner).
// ============================================================================

export class WorkerPool {
  constructor(count, init) {
    this.workers = [];
    this.idle = [];
    this.queue = [];      // pending jobs, kept sorted lazily
    this.pending = new Map(); // job id -> resolve
    this.nextId = 1;
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this._onResult(w, e.data);
      w.onerror = (e) => console.error('Worker error', e.message || e);
      w.postMessage(init);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get busy() { return this.workers.length - this.idle.length; }
  get queued() { return this.queue.length; }

  /** Broadcast a message to every worker (e.g. re-init for a new world seed). */
  broadcast(msg) {
    for (const w of this.workers) w.postMessage(msg);
  }

  /**
   * Queue a job. `priority` is evaluated when the job is picked, so callers
   * can pass a function (e.g. distance to the player right now).
   */
  run(msg, priority = 0, transfer = []) {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.queue.push({ id, msg: { ...msg, id }, priority, transfer, resolve });
      this._pump();
    });
  }

  /** Drop queued jobs that are no longer wanted (e.g. chunk unloaded). */
  cancel(predicate) {
    this.queue = this.queue.filter(j => {
      if (predicate(j.msg)) { j.resolve(null); return false; }
      return true;
    });
  }

  _pump() {
    while (this.idle.length && this.queue.length) {
      // pick the job with the lowest priority value
      let best = 0, bestP = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const p = typeof this.queue[i].priority === 'function' ? this.queue[i].priority() : this.queue[i].priority;
        if (p < bestP) { bestP = p; best = i; }
      }
      const job = this.queue.splice(best, 1)[0];
      const w = this.idle.pop();
      this.pending.set(job.id, job.resolve);
      w.postMessage(job.msg, job.transfer);
    }
  }

  _onResult(worker, data) {
    const resolve = this.pending.get(data.id);
    this.pending.delete(data.id);
    this.idle.push(worker);
    if (resolve) resolve(data);
    this._pump();
  }
}
