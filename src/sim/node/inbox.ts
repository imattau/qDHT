type Envelope = {
  from: string
  message: unknown
}

export class Inbox {
  private queue: unknown[] = []
  private online = true

  setOnline(online: boolean): void {
    this.online = online
  }

  enqueue(message: unknown): void {
    if (!this.online) {
      return
    }
    this.queue.push(JSON.parse(JSON.stringify(message)))
  }

  enqueueFrom(from: string, message: unknown): void {
    if (!this.online) {
      return
    }
    const envelope: Envelope = { from, message }
    this.queue.push(JSON.parse(JSON.stringify(envelope)))
  }

  drain(): unknown[] {
    const messages = this.queue
    this.queue = []
    return messages
  }

  get length(): number {
    return this.queue.length
  }
}
