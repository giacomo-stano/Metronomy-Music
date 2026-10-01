// Each mounted screen owns its cache; no data crosses an account boundary.
export class ScreenCache<T> {
  private values = new Map<string, T>();
  private pending = new Map<string, Promise<T>>();
  private scope = '';
  private generation = 0;
  constructor(private readonly limit = 12) {}
  useScope(scope: string) {
    if (scope === this.scope) return;
    this.scope = scope;
    this.generation++;
    this.values.clear();
    this.pending.clear();
  }
  peek(key: string) { return this.values.get(key); }
  set(key: string, value: T) {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!);
  }
  get(key: string, load: () => Promise<T>): Promise<T> {
    if (this.values.has(key)) return Promise.resolve(this.values.get(key)!);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const version = this.generation;
    const task = Promise.resolve().then(load).then(value => {
      if (version === this.generation) this.set(key, value);
      return value;
    }).finally(() => {
      if (this.pending.get(key) === task) this.pending.delete(key);
    });
    this.pending.set(key, task);
    return task;
  }
}
