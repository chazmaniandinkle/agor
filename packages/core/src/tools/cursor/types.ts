/**
 * Cursor Agent Types
 *
 * Type definitions for Cursor Agent CLI NDJSON events and internal state.
 */

/**
 * Cursor Agent event types from NDJSON stream
 */
export type CursorEvent =
  | CursorSystemEvent
  | CursorUserEvent
  | CursorAssistantEvent
  | CursorToolCallEvent
  | CursorResultEvent;

/**
 * System initialization event
 * Emitted when session starts, contains session_id
 */
export interface CursorSystemEvent {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  cwd: string;
  permission_mode?: string;
}

/**
 * User message event
 * Echoes the user's prompt
 */
export interface CursorUserEvent {
  type: 'user';
  message: {
    role: 'user';
    text: string;
  };
}

/**
 * Assistant message event
 * Streams assistant's response text
 */
export interface CursorAssistantEvent {
  type: 'assistant';
  message: {
    role: 'assistant';
    text: string;
  };
}

/**
 * Tool call event
 * Tracks tool execution (started/completed)
 */
export interface CursorToolCallEvent {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

/**
 * Result event
 * Terminal event with usage statistics
 */
export interface CursorResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  context_window?: number;
}

/**
 * Session context stored for each Agor session
 */
export interface SessionContext {
  /** Cursor's internal session ID */
  cursorSessionId: string;
  /** Working directory */
  workingDir: string;
  /** Model identifier */
  model?: string;
  /** Git reference */
  gitRef?: string;
  /** Session creation timestamp */
  createdAt: Date;
  /** Last used timestamp */
  lastUsedAt: Date;
  /** Message count for stats */
  messageCount: number;
}

/**
 * Tool call tracking state
 */
export interface ToolCallState {
  /** Agor-generated tool use ID */
  id: string;
  /** Tool name (e.g., 'read_file') */
  name: string;
  /** Tool input arguments */
  input: Record<string, unknown>;
  /** Tool start timestamp */
  startedAt: Date;
  /** Whether tool has completed */
  completed?: boolean;
  /** Tool result */
  result?: unknown;
  /** Tool completion timestamp */
  completedAt?: Date;
}

/**
 * Cursor tool configuration
 */
export interface CursorConfig {
  /** Whether Cursor integration is enabled */
  enabled: boolean;
  /** Cursor API key (or env CURSOR_API_KEY) */
  apiKey?: string;
  /** Default model */
  model?: string;
  /** Permission mode */
  permissionMode?: 'ask' | 'auto' | 'allow-all';
}
