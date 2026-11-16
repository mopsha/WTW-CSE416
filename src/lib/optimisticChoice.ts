import { isAccessDenied, messageOf } from './errors';

// Ordering only: no account or entity data is retained globally.
let clock = 0;
export const mutationStamp = () => ++clock;
export interface ChoiceSnapshot<T, S> {
  confirmed: T | null;
  desired: S | undefined;
  value: T | null;
  pending: boolean;
  uncertain: boolean;
  error: string | null;
}
interface Options<T, S> {
  read(): Promise<T>;
  write(desired: S, current: () => boolean): Promise<T | void>;
  readAfterWrite?: boolean;
  project(confirmed: T, desired: S): T;
  selected(confirmed: T): S;
  eligible(value: T): boolean;
  onDenied?(error: unknown): void;
}
/** One reversible choice for one mounted account/entity. Never retries a write blindly. */
export class OptimisticChoice<T, S> {
  private alive = true;
  private epoch = 0;
  private version = 0;
  private stamp = 0;
  private lastRead = 0;
  private blocked = false;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private state: ChoiceSnapshot<T, S>;
  constructor(
    private options: Options<T, S>,
    initial: T | null = null,
  ) {
    this.state = {
      confirmed: initial,
      value: initial,
      desired: undefined,
      pending: false,
      uncertain: false,
      error: null,
    };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ChoiceSnapshot<T, S>>) {
    if (!this.alive) return;
    const next = { ...this.state, ...patch };
    next.value =
      next.confirmed === null
        ? null
        : next.desired === undefined || next.uncertain
          ? next.confirmed
          : this.options.project(next.confirmed, next.desired);
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }
  /** Snapshots fetched before a newer intent/settlement cannot replace that intent's baseline. */
  accept(value: T, started = mutationStamp(), revalidate = false) {
    if (
      !this.alive ||
      (this.blocked && !revalidate) ||
      started < this.stamp ||
      started < this.lastRead
    )
      return;
    this.lastRead = started;
    if (revalidate) this.blocked = false;
    if (!this.options.eligible(value)) {
      this.clear('This item is no longer available.');
      return;
    }
    this.publish({ confirmed: value, uncertain: false, error: null });
  }
  choose(desired: S) {
    if (
      !this.alive ||
      this.blocked ||
      this.state.uncertain ||
      this.state.confirmed === null ||
      !this.options.eligible(this.state.confirmed)
    )
      return false;
    this.version++;
    this.stamp = mutationStamp();
    this.publish({ desired, pending: true, error: null });
    this.drain();
    return true;
  }
  private drain() {
    if (this.running || !this.alive || this.blocked || this.state.desired === undefined) return;
    const epoch = this.epoch;
    const current = () => this.alive && this.epoch === epoch;
    const run = async () => {
      while (current() && this.state.desired !== undefined && !this.state.uncertain) {
        const desired = this.state.desired;
        const version = this.version;
        // Coalesce toggles that end at the already-confirmed state.
        if (
          this.state.confirmed !== null &&
          Object.is(this.options.selected(this.state.confirmed), desired)
        ) {
          this.publish({ desired: undefined, pending: false, error: null });
          break;
        }
        try {
          let confirmed: T | void = await this.options.write(desired, current);
          if (!current()) return;
          if (this.options.readAfterWrite) {
            const started = mutationStamp();
            const response = await this.options.read();
            if (!current()) return;
            // A later focus/poll snapshot may already include other participants' changes.
            confirmed =
              started < this.lastRead && this.state.confirmed !== null
                ? this.state.confirmed
                : response;
            this.lastRead = Math.max(this.lastRead, started);
          }
          if (confirmed === undefined) throw new Error('Missing server confirmation');
          this.stamp = mutationStamp();
          if (!this.options.eligible(confirmed)) {
            this.clear('This item is no longer available.');
            return;
          }
          this.publish({
            confirmed,
            error: null,
            ...(version === this.version ? { desired: undefined, pending: false } : {}),
          });
        } catch (error) {
          if (!current()) return;
          this.stamp = mutationStamp();
          if (isAccessDenied(error)) {
            this.clear(messageOf(error));
            this.options.onDenied?.(error);
            return;
          }
          const status = Number((error as { status?: unknown } | null)?.status);
          const definitive = status >= 400 && status < 500 && status !== 408 && status !== 409;
          if (definitive) {
            this.publish({
              error: messageOf(error),
              ...(version === this.version ? { desired: undefined, pending: false } : {}),
            });
          } else {
            // A lost response may follow a committed write. Read before rollback or compensation.
            try {
              const confirmed = await this.options.read();
              if (!current()) return;
              this.stamp = mutationStamp();
              if (!this.options.eligible(confirmed)) {
                this.clear('This item is no longer available.');
                return;
              }
              this.publish({
                confirmed,
                error: Object.is(this.options.selected(confirmed), desired)
                  ? null
                  : 'Change was not saved. Please try again.',
                ...(version === this.version ? { desired: undefined, pending: false } : {}),
              });
            } catch (readError) {
              if (!current()) return;
              if (isAccessDenied(readError)) {
                this.clear(messageOf(readError));
                this.options.onDenied?.(readError);
                return;
              }
              this.publish({
                desired: undefined,
                pending: false,
                uncertain: true,
                error: 'Couldn’t confirm this change. Refresh before trying again.',
              });
            }
          }
        }
      }
    };
    const task = run();
    this.running = task;
    void task.finally(() => {
      if (this.running === task) this.running = null;
      if (this.alive && !this.blocked && this.state.desired !== undefined) this.drain();
    });
  }
  refresh = async () => {
    const epoch = this.epoch;
    // After blur/background, finish any sent request before revalidating this same scope.
    if (this.blocked && this.running) await this.running;
    if (!this.alive || epoch !== this.epoch) return;
    const started = mutationStamp();
    try {
      const value = await this.options.read();
      if (!this.alive || epoch !== this.epoch || started < this.stamp || started < this.lastRead)
        return;
      this.blocked = false;
      this.accept(value, started);
      if (!this.blocked) this.publish({ uncertain: false, error: null });
    } catch (error) {
      if (!this.alive || epoch !== this.epoch || started < this.stamp || started < this.lastRead)
        return;
      if (isAccessDenied(error)) this.clear(messageOf(error));
      else this.publish({ error: messageOf(error) });
    }
  };
  clear = (error: string | null = null) => {
    this.epoch++;
    this.blocked = true;
    this.stamp = mutationStamp();
    this.publish({ confirmed: null, desired: undefined, pending: false, uncertain: false, error });
  };
  settled() {
    return this.running ?? Promise.resolve();
  }
  activate() {
    // React Strict Mode may replay effects for the same owner; revalidate, never revive a draft.
    if (!this.alive) {
      this.alive = true;
      void this.refresh();
    }
  }
  dispose() {
    this.listeners.clear();
    this.clear();
    this.alive = false;
  }
}
