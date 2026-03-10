import { QueuedMessage } from "../types";

export class MessageQueue {
  private readonly items: QueuedMessage[] = [];

  public add(message: QueuedMessage): void {
    this.items.push(message);
  }

  public next(): QueuedMessage | undefined {
    return this.items.shift();
  }

  public get size(): number {
    return this.items.length;
  }
}
