export class ReviewUrlDispatcher<T> {
  private ready = false
  private pending: T | null = null
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly deliver: (value: T) => void | Promise<void>,
    private readonly onError: (error: unknown) => void = () => {}
  ) {}

  receive(value: T): void {
    if (!this.ready) {
      this.pending = value
      return
    }
    this.enqueue(value)
  }

  markReady(): void {
    if (this.ready) return
    this.ready = true
    if (this.pending !== null) {
      const pending = this.pending
      this.pending = null
      this.enqueue(pending)
    }
  }

  whenIdle(): Promise<void> {
    return this.tail
  }

  private enqueue(value: T): void {
    const delivery = this.tail.then(() => this.deliver(value))
    this.tail = delivery.catch((error: unknown) => {
      this.onError(error)
    })
  }
}
