export interface PrivateStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Private device values, indexed so sign-out also deletes routes not opened since an app restart. */
export class PrivateStore {
  private memory = new Map<string, string>();
  private epochs = new Map<string, number>();
  private queues = new Map<string, Promise<void>>();
  private closed = new Set<string>();
  private storage: PrivateStorage | null;
  private prefix: string;
  constructor(storage: PrivateStorage | null, prefix: string) {
    this.storage = storage;
    this.prefix = prefix;
  }
  private key(scope: string, name: string) {
    return `${this.prefix}.${Array.from(`${scope}:${name}`, (letter) => letter.charCodeAt(0).toString(16)).join("-")}`;
  }
  private async queue(scope: string, run: () => Promise<void>) {
    const next = (this.queues.get(scope) ?? Promise.resolve()).then(run);
    this.queues.set(
      scope,
      next.catch(() => {}),
    );
    return next;
  }
  activate(scope: string) {
    this.closed.delete(scope);
  }
  async read(scope: string, name: string): Promise<string | null> {
    if (this.closed.has(scope)) return null;
    const key = this.key(scope, name);
    const known = this.memory.get(key);
    if (known !== undefined) return known;
    const epoch = this.epochs.get(scope) ?? 0;
    const stored = (await this.storage?.get(key)) ?? null;
    if (this.closed.has(scope) || epoch !== (this.epochs.get(scope) ?? 0)) return null;
    if (stored !== null) this.memory.set(key, stored);
    return stored;
  }
  async write(scope: string, name: string, value: string): Promise<void> {
    if (this.closed.has(scope)) throw new Error("This session ended");
    const key = this.key(scope, name);
    const epoch = this.epochs.get(scope) ?? 0;
    this.memory.set(key, value);
    return this.queue(scope, async () => {
      if (this.closed.has(scope) || epoch !== (this.epochs.get(scope) ?? 0)) return;
      if (this.storage === null) return;
      const indexKey = this.key(scope, "index");
      const raw = await this.storage.get(indexKey);
      const names = new Set<string>(raw === null ? [] : (JSON.parse(raw) as string[]));
      names.add(name);
      // The index goes first: interrupted writes can leave only a harmless empty indexed slot.
      await this.storage.set(indexKey, JSON.stringify([...names]));
      await this.storage.set(key, value);
    });
  }
  async remove(scope: string, name: string): Promise<void> {
    const key = this.key(scope, name);
    this.memory.delete(key);
    return this.queue(scope, async () => {
      await this.storage?.remove(key);
    });
  }
  async clear(scope: string): Promise<void> {
    this.closed.add(scope);
    this.epochs.set(scope, (this.epochs.get(scope) ?? 0) + 1);
    for (const key of this.memory.keys()) {
      if (key.startsWith(this.key(scope, ""))) this.memory.delete(key);
    }
    return this.queue(scope, async () => {
      if (this.storage === null) return;
      const indexKey = this.key(scope, "index");
      const raw = await this.storage.get(indexKey);
      const names: string[] = raw === null ? [] : (JSON.parse(raw) as string[]);
      await Promise.all(names.map((name) => this.storage?.remove(this.key(scope, name))));
      await this.storage.remove(indexKey);
    });
  }
}
