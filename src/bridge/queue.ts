export class MessageQueue {
  private readonly items: string[] = [];

  public add(message: string): void {
    this.items.push(message);
  }

  public next(): string | undefined {
    return this.items.shift();
  }

  public get size(): number {
    return this.items.length;
  }
}
