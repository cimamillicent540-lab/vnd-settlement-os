export type TriggerGuardResult =
  | { status: "ACQUIRED"; release: () => void }
  | { status: "IN_PROGRESS" | "DUPLICATE"; release: null };

export class SettlementAiTriggerGuard {
  readonly #inFlight = new Set<string>();
  readonly #subjectsInFlight = new Set<string>();
  readonly #completed = new Map<string, number>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  acquire(subject: string, idempotencyKey: string): TriggerGuardResult {
    const now = this.clock();
    for (const [key, expiresAt] of this.#completed) {
      if (expiresAt <= now) this.#completed.delete(key);
    }
    const key = `${subject}:${idempotencyKey}`;
    if (this.#inFlight.has(key) || this.#subjectsInFlight.has(subject)) {
      return { status: "IN_PROGRESS", release: null };
    }
    if ((this.#completed.get(key) ?? 0) > now) {
      return { status: "DUPLICATE", release: null };
    }
    this.#inFlight.add(key);
    this.#subjectsInFlight.add(subject);
    let released = false;
    return {
      status: "ACQUIRED",
      release: () => {
        if (released) return;
        released = true;
        this.#inFlight.delete(key);
        this.#subjectsInFlight.delete(subject);
        this.#completed.set(key, this.clock() + this.ttlMs);
      },
    };
  }
}

export const settlementAiTriggerGuard = new SettlementAiTriggerGuard();
