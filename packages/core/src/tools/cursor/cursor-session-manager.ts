/**
 * Session Context Manager
 *
 * Tracks Cursor session contexts for Agor sessions.
 * Maintains mapping between Agor session IDs and Cursor session IDs.
 */

import type { SessionContext } from './types';

export class CursorSessionManager {
  private sessions = new Map<string, SessionContext>();

  /**
   * Create new session context
   */
  createContext(
    agorSessionId: string,
    options: {
      cursorSessionId: string;
      workingDir: string;
      model?: string;
      gitRef?: string;
    }
  ): void {
    this.sessions.set(agorSessionId, {
      cursorSessionId: options.cursorSessionId,
      workingDir: options.workingDir,
      model: options.model,
      gitRef: options.gitRef,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      messageCount: 0,
    });
  }

  /**
   * Get session context
   */
  getContext(agorSessionId: string): SessionContext | undefined {
    const context = this.sessions.get(agorSessionId);

    if (context) {
      context.lastUsedAt = new Date(); // Update last used timestamp
    }

    return context;
  }

  /**
   * Update session stats
   */
  incrementMessageCount(agorSessionId: string): void {
    const context = this.sessions.get(agorSessionId);
    if (context) {
      context.messageCount++;
      context.lastUsedAt = new Date();
    }
  }

  /**
   * Remove session context
   */
  deleteContext(agorSessionId: string): boolean {
    return this.sessions.delete(agorSessionId);
  }

  /**
   * Clean up old sessions (memory management)
   */
  pruneInactiveSessions(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let pruned = 0;

    for (const [sessionId, context] of this.sessions.entries()) {
      const age = now - context.lastUsedAt.getTime();
      if (age > maxAgeMs) {
        this.sessions.delete(sessionId);
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[CursorSessionManager] Pruned ${pruned} inactive sessions`);
    }

    return pruned;
  }

  /**
   * Get all session IDs
   */
  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}
