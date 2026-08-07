export class AsyncMutationTracker {
  private readonly pending = new Set<Promise<void>>()

  track<T>(operation: () => Promise<T>): Promise<T> {
    const result = Promise.resolve().then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.pending.add(settled)
    void settled.finally(() => { this.pending.delete(settled) })
    return result
  }

  async wait(): Promise<void> {
    while (this.pending.size) {
      await Promise.all([...this.pending])
    }
  }

  get size(): number {
    return this.pending.size
  }
}
