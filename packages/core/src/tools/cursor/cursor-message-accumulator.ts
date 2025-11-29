/**
 * Message Accumulator
 *
 * Buffers streaming text and flushes in chunks for optimal UX.
 * Prevents overwhelming the UI with tiny updates while maintaining responsiveness.
 */

export class MessageAccumulator {
  private buffer = '';
  private wordCount = 0;
  private lastFlushTime = Date.now();

  private readonly CHUNK_SIZE_WORDS = 5; // Flush every 5 words
  private readonly FLUSH_INTERVAL_MS = 100; // Or every 100ms

  constructor(
    private messageId: string,
    private onChunk: (chunk: string) => Promise<void>
  ) {}

  /**
   * Add text to buffer and flush if threshold reached
   */
  async addText(text: string): Promise<void> {
    this.buffer += text;

    // Count words in buffer
    const words = this.buffer.split(/\s+/);
    this.wordCount = words.length;

    const now = Date.now();
    const timeSinceFlush = now - this.lastFlushTime;

    // Flush if we hit word threshold or time threshold
    if (
      this.wordCount >= this.CHUNK_SIZE_WORDS ||
      timeSinceFlush >= this.FLUSH_INTERVAL_MS
    ) {
      await this.flush();
    }
  }

  /**
   * Flush accumulated text to callback
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    await this.onChunk(this.buffer);

    this.buffer = '';
    this.wordCount = 0;
    this.lastFlushTime = Date.now();
  }

  /**
   * Get full accumulated text (even unflushed)
   */
  getFullText(): string {
    return this.buffer;
  }
}
