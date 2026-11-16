import { api } from './api';
import { isAccessDenied, messageOf } from './errors';
import { mutationStamp, OptimisticChoice } from './optimisticChoice';

/** Screen/account-scoped IDs only. Cards and details use these same per-place queues. */
export class SavedChoices {
  constructor(private viewer: string) {}
  private alive = true;
  private epoch = 0;
  private latestRead = 0;
  private revision = 0;
  private listeners = new Set<() => void>();
  private choices = new Map<string, OptimisticChoice<boolean, boolean>>();
  private saved = new Set<string>();
  private hidden = false;
  ready = false;
  error: string | null = null;
  undo: { id: string; token: number } | null = null;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.revision;
  private emit = () => {
    if (this.alive) {
      this.revision++;
      this.listeners.forEach((fn) => fn());
    }
  };
  item(id: string) {
    let choice = this.choices.get(id);
    if (!choice) {
      choice = new OptimisticChoice<boolean, boolean>(
        {
          read: async () => (await api.getSaved(this.viewer)).places.some((p) => p.placeId === id),
          write: async (desired) => {
            await (desired ? api.savePlace(id, this.viewer) : api.removeSaved(id, this.viewer));
            return desired;
          },
          project: (_, desired) => desired,
          selected: (value) => value,
          eligible: () => true,
          onDenied: (error) => {
            this.clear();
            this.error = messageOf(error);
            this.emit();
          },
        },
        this.ready ? this.saved.has(id) : null,
      );
      choice.subscribe(this.emit);
      this.choices.set(id, choice);
    }
    return choice;
  }
  toggle(id: string) {
    if (!this.ready || !this.alive || this.hidden) return;
    const item = this.item(id);
    const desired = !item.snapshot().value;
    if (!item.choose(desired)) return;
    this.undo = desired ? null : { id, token: mutationStamp() };
    this.emit();
  }
  restore = (token: number) => {
    const undo = this.undo;
    if (!this.alive || this.hidden || !this.ready || !undo || undo.token !== token) return;
    const item = this.item(undo.id);
    // Never let an uncertain or definitively failed removal advertise a fake restoration.
    if (item.snapshot().value === false && item.choose(true)) {
      this.undo = null;
      this.emit();
    }
  };
  dismissUndo = (token: number) => {
    if (this.undo?.token === token) {
      this.undo = null;
      this.emit();
    }
  };
  reload = async () => {
    if (!this.viewer) return;
    const epoch = this.epoch;
    if (this.hidden)
      await Promise.all([...this.choices.values()].map((choice) => choice.settled()));
    if (!this.alive || epoch !== this.epoch) return;
    const started = mutationStamp();
    this.latestRead = started;
    try {
      const result = await api.getSaved(this.viewer);
      if (!this.alive || epoch !== this.epoch || started !== this.latestRead) return;
      this.saved = new Set(result.places.map((p) => p.placeId));
      this.ready = true;
      this.hidden = false;
      this.error = null;
      this.choices.forEach((choice, id) => choice.accept(this.saved.has(id), started, true));
      this.emit();
    } catch (error) {
      if (!this.alive || epoch !== this.epoch || started !== this.latestRead) return;
      if (isAccessDenied(error)) this.clear();
      this.error = messageOf(error);
      this.emit();
    }
  };
  feedback() {
    return (
      this.error ??
      [...this.choices.values()].map((choice) => choice.snapshot().error).find(Boolean) ??
      null
    );
  }
  clear = () => {
    this.epoch++;
    this.hidden = true;
    this.ready = false;
    this.undo = null;
    this.saved.clear();
    this.choices.forEach((choice) => choice.clear());
    this.error = null;
    this.emit();
  };
  activate() {
    if (!this.alive) {
      this.alive = true;
      this.choices.clear();
      void this.reload();
    }
  }
  dispose() {
    this.listeners.clear();
    this.clear();
    this.alive = false;
    this.choices.forEach((choice) => choice.dispose());
  }
}
