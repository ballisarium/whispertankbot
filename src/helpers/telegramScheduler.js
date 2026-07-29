const DEFAULT_LIMITS = {
  deliveryConcurrency: 30,
  interactiveConcurrency: 16,
  lookupConcurrency: 8,
  maxQueue: 1000,
};

export class TelegramSchedulerOverloadedError extends Error {
  constructor(lane) {
    super(`Telegram ${lane} queue is full`);
    this.name = 'TelegramSchedulerOverloadedError';
    this.kind = 'overloaded';
    this.lane = lane;
  }
}

export class TelegramSchedulerClosedError extends Error {
  constructor() {
    super('Telegram request scheduler is closed');
    this.name = 'TelegramSchedulerClosedError';
    this.kind = 'shutdown';
  }
}

class WorkLane {
  constructor({ concurrency, maxQueue, name }) {
    this.active = 0;
    this.closedError = null;
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.name = name;
    this.queue = [];
    this.running = new Set();
  }

  enqueue(operation) {
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.active >= this.concurrency && this.queue.length >= this.maxQueue) {
      return Promise.reject(new TelegramSchedulerOverloadedError(this.name));
    }

    const promise = new Promise((resolve, reject) => {
      this.queue.push({ operation, reject, resolve });
    });
    this.drain();
    return promise;
  }

  drain() {
    while (!this.closedError && this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this.active++;
      const running = Promise.resolve().then(job.operation);
      this.running.add(running);
      running
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.running.delete(running);
          this.drain();
        });
    }
  }

  close(error) {
    if (this.closedError) return;
    this.closedError = error;
    for (const job of this.queue.splice(0)) {
      job.reject(error);
    }
  }

  runningPromises() {
    return [...this.running];
  }
}

class DeliveryLane {
  constructor({ concurrency, maxQueue, now, sleep }) {
    this.activeScopes = new Set();
    this.closedError = null;
    this.concurrency = concurrency;
    this.globalStarts = [];
    this.lastScopeStart = new Map();
    this.maxQueue = maxQueue;
    this.now = now;
    this.pacingTail = Promise.resolve();
    this.pending = 0;
    this.readyScopeSet = new Set();
    this.readyScopes = [];
    this.running = new Set();
    this.scopeQueues = new Map();
    this.sleep = sleep;
  }

  enqueue(scope, operation) {
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.pending >= this.maxQueue) {
      return Promise.reject(new TelegramSchedulerOverloadedError('delivery'));
    }

    const normalizedScope = String(scope);
    const promise = new Promise((resolve, reject) => {
      const queue = this.scopeQueues.get(normalizedScope) || [];
      queue.push({ operation, reject, resolve });
      this.scopeQueues.set(normalizedScope, queue);
      this.pending++;
      this.markReady(normalizedScope);
    });
    this.drain();
    return promise;
  }

  markReady(scope) {
    if (
      this.activeScopes.has(scope)
      || this.readyScopeSet.has(scope)
      || !this.scopeQueues.get(scope)?.length
    ) {
      return;
    }
    this.readyScopeSet.add(scope);
    this.readyScopes.push(scope);
  }

  async reserveStart(scope) {
    const previous = this.pacingTail;
    let release;
    this.pacingTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      while (true) {
        if (this.closedError) throw this.closedError;
        const currentTime = this.now();
        this.globalStarts = this.globalStarts.filter(
          (startedAt) => currentTime - startedAt < 1000
        );
        const scopeWait = Math.max(
          0,
          (this.lastScopeStart.get(scope) ?? -1000) + 1000 - currentTime
        );
        const globalWait = this.globalStarts.length < 30
          ? 0
          : Math.max(0, this.globalStarts[0] + 1000 - currentTime);
        const waitMs = Math.max(scopeWait, globalWait);
        if (waitMs === 0) {
          this.lastScopeStart.set(scope, currentTime);
          this.globalStarts.push(currentTime);
          return;
        }
        await this.sleep(waitMs);
      }
    } finally {
      release();
    }
  }

  drain() {
    while (
      !this.closedError
      && this.activeScopes.size < this.concurrency
      && this.readyScopes.length > 0
    ) {
      const scope = this.readyScopes.shift();
      this.readyScopeSet.delete(scope);
      const queue = this.scopeQueues.get(scope);
      if (!queue?.length || this.activeScopes.has(scope)) continue;

      const job = queue.shift();
      this.pending--;
      this.activeScopes.add(scope);
      const running = (async () => {
        await this.reserveStart(scope);
        return job.operation();
      })();
      this.running.add(running);
      running
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running.delete(running);
          this.activeScopes.delete(scope);
          const remaining = this.scopeQueues.get(scope);
          if (remaining?.length) {
            this.markReady(scope);
          } else {
            this.scopeQueues.delete(scope);
          }
          this.drain();
        });
    }
  }

  close(error) {
    if (this.closedError) return;
    this.closedError = error;
    for (const queue of this.scopeQueues.values()) {
      for (const job of queue) {
        job.reject(error);
      }
    }
    this.pending = 0;
    this.readyScopeSet.clear();
    this.readyScopes.length = 0;
    this.scopeQueues.clear();
  }

  runningPromises() {
    return [...this.running];
  }
}

export function createTelegramScheduler({
  limits = {},
  now = () => Date.now(),
  sleep,
} = {}) {
  const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
  const timers = new Set();
  let closedError = null;

  const schedulerSleep = sleep || ((ms) => new Promise((resolve, reject) => {
    const entry = { reject, timer: null };
    entry.timer = setTimeout(() => {
      timers.delete(entry);
      resolve();
    }, ms);
    timers.add(entry);
  }));

  const interactiveLane = new WorkLane({
    concurrency: resolvedLimits.interactiveConcurrency,
    maxQueue: resolvedLimits.maxQueue,
    name: 'interactive',
  });
  const lookupLane = new WorkLane({
    concurrency: resolvedLimits.lookupConcurrency,
    maxQueue: resolvedLimits.maxQueue,
    name: 'lookup',
  });
  const deliveryLane = new DeliveryLane({
    concurrency: resolvedLimits.deliveryConcurrency,
    maxQueue: resolvedLimits.maxQueue,
    now,
    sleep: schedulerSleep,
  });
  const lookupInFlight = new Map();

  const interactive = (operation) => interactiveLane.enqueue(operation);
  const delivery = (scope, operation) => deliveryLane.enqueue(scope, operation);
  const lookup = (key, operation) => {
    if (closedError) return Promise.reject(closedError);
    const normalizedKey = String(key);
    const existing = lookupInFlight.get(normalizedKey);
    if (existing) return existing;

    const request = lookupLane.enqueue(operation);
    lookupInFlight.set(normalizedKey, request);
    request.then(
      () => lookupInFlight.delete(normalizedKey),
      () => lookupInFlight.delete(normalizedKey)
    );
    return request;
  };

  const shutdown = async ({ graceMs = 5000 } = {}) => {
    if (closedError) return;
    closedError = new TelegramSchedulerClosedError();
    interactiveLane.close(closedError);
    lookupLane.close(closedError);
    deliveryLane.close(closedError);

    for (const entry of timers) {
      clearTimeout(entry.timer);
      entry.reject(closedError);
    }
    timers.clear();

    const running = Promise.allSettled([
      ...interactiveLane.runningPromises(),
      ...lookupLane.runningPromises(),
      ...deliveryLane.runningPromises(),
    ]);
    if (graceMs <= 0) return;

    let graceTimer;
    await Promise.race([
      running,
      new Promise((resolve) => {
        graceTimer = setTimeout(resolve, graceMs);
      }),
    ]);
    clearTimeout(graceTimer);
  };

  return { delivery, interactive, lookup, shutdown };
}

let telegramScheduler = createTelegramScheduler();

export const scheduleInteractive = (operation, meta) =>
  telegramScheduler.interactive(operation, meta);
export const scheduleDelivery = (scope, operation, meta) =>
  telegramScheduler.delivery(scope, operation, meta);
export const scheduleLookup = (key, operation, meta) =>
  telegramScheduler.lookup(key, operation, meta);
export const shutdownTelegramScheduler = (options) =>
  telegramScheduler.shutdown(options);
export const setTelegramSchedulerForTests = (scheduler) => {
  telegramScheduler = scheduler;
};
export const resetTelegramSchedulerForTests = () => {
  telegramScheduler = createTelegramScheduler();
};

export const deliveryScopeFor = (ctx) =>
  ctx.chat?.id != null
    ? `chat:${ctx.chat.id}`
    : ctx.callbackQuery?.inline_message_id
      ? `inline:${ctx.callbackQuery.inline_message_id}`
      : `user:${ctx.from?.id ?? 'unknown'}`;
