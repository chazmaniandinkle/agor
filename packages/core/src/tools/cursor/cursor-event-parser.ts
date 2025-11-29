/**
 * Cursor Event Parser
 *
 * Parses NDJSON event stream from cursor-agent CLI output.
 * Handles malformed lines gracefully without crashing the stream.
 */

import { createInterface } from 'readline';
import type { Readable } from 'stream';
import type { CursorEvent } from './types';

export class CursorEventParser {
  /**
   * Parse NDJSON stream into async generator of events
   *
   * @param stream - Readable stream from cursor-agent process
   * @yields Cursor events
   */
  async *parseStream(stream: Readable): AsyncGenerator<CursorEvent> {
    const readline = createInterface({ input: stream });

    for await (const line of readline) {
      // Skip empty lines
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line) as CursorEvent;
        yield event;
      } catch (err) {
        // Log error but don't crash - continue processing stream
        console.error('[CursorEventParser] Failed to parse line:', line, err);
      }
    }
  }

  /**
   * Wait for specific event type with timeout
   *
   * @param stream - Readable stream
   * @param eventType - Event type to wait for
   * @param timeout - Timeout in milliseconds (default: 10s)
   * @returns Matching event
   * @throws Error if timeout or stream ends without event
   */
  async waitForEvent<T extends CursorEvent['type']>(
    stream: Readable,
    eventType: T,
    timeout = 10000
  ): Promise<Extract<CursorEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for event type: ${eventType}`));
      }, timeout);

      (async () => {
        try {
          for await (const event of this.parseStream(stream)) {
            if (event.type === eventType) {
              clearTimeout(timeoutId);
              resolve(event as Extract<CursorEvent, { type: T }>);
              return;
            }
          }
          clearTimeout(timeoutId);
          reject(new Error(`Stream ended without receiving event: ${eventType}`));
        } catch (err) {
          clearTimeout(timeoutId);
          reject(err);
        }
      })();
    });
  }
}
