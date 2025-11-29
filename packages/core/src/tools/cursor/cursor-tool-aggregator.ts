/**
 * Tool Call Aggregator
 *
 * Tracks tool call lifecycle (started → completed) and creates Agor messages.
 * Cursor doesn't provide tool call IDs, so we match by name and sequence.
 */

import { generateId } from '../../lib/ids';
import { MessageRole } from '../../types';
import type { CursorToolCallEvent, ToolCallState } from './types';

/**
 * Service interface for creating messages
 */
export interface MessagesService {
  create(data: {
    message_id: string;
    session_id: string;
    task_id?: string;
    type: 'assistant';
    role: typeof MessageRole.ASSISTANT;
    index: number;
    timestamp: string;
    content_preview: string;
    content: Array<{
      type: 'tool_use' | 'tool_result';
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>;
    tool_uses?: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;
  }): Promise<unknown>;
}

export class ToolCallAggregator {
  private pendingTools = new Map<string, ToolCallState>();

  /**
   * Generate unique tool call ID (compatible with Claude's format)
   */
  private generateToolId(): string {
    return `toolu_${generateId().slice(0, 12)}`;
  }

  /**
   * Handle tool_call started event
   */
  async onToolStarted(event: CursorToolCallEvent): Promise<void> {
    const toolId = this.generateToolId();

    this.pendingTools.set(toolId, {
      id: toolId,
      name: event.name,
      input: (event.args || {}) as Record<string, unknown>,
      startedAt: new Date(),
    });

    console.log(`[ToolAggregator] Tool started: ${event.name} (${toolId})`);
  }

  /**
   * Handle tool_call completed event
   */
  async onToolCompleted(
    event: CursorToolCallEvent,
    sessionId: string,
    taskId: string | undefined,
    messagesService: MessagesService
  ): Promise<void> {
    // Find matching pending tool (Cursor doesn't provide IDs, match by name)
    const toolState = Array.from(this.pendingTools.values()).find(
      (t) => t.name === event.name && !t.completed
    );

    if (!toolState) {
      console.warn(`[ToolAggregator] No pending tool found for: ${event.name}`);
      return;
    }

    toolState.completed = true;
    toolState.result = event.result;
    toolState.completedAt = new Date();

    // Create tool message in Agor database
    const messageId = generateId();

    await messagesService.create({
      message_id: messageId,
      session_id: sessionId,
      task_id: taskId,
      type: 'assistant',
      role: MessageRole.ASSISTANT,
      index: 0, // TODO: Calculate proper index
      timestamp: new Date().toISOString(),
      content_preview: `Tool: ${event.name}`,
      content: [
        {
          type: 'tool_use',
          id: toolState.id,
          name: toolState.name,
          input: toolState.input,
        },
        {
          type: 'tool_result',
          tool_use_id: toolState.id,
          content: this.formatToolResult(event.result),
          is_error: false,
        },
      ],
      tool_uses: [
        {
          id: toolState.id,
          name: toolState.name,
          input: toolState.input,
        },
      ],
    });

    this.pendingTools.delete(toolState.id);
    console.log(`[ToolAggregator] Tool completed: ${event.name} (${toolState.id})`);
  }

  /**
   * Format tool result for display
   */
  private formatToolResult(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && 'content' in result) {
      return String((result as { content: unknown }).content);
    }
    return JSON.stringify(result, null, 2);
  }

  /**
   * Get all pending tools (for debugging)
   */
  getPendingTools(): ToolCallState[] {
    return Array.from(this.pendingTools.values());
  }
}
