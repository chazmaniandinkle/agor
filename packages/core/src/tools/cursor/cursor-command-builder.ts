/**
 * CLI Command Builder
 *
 * Type-safe builder for constructing cursor-agent CLI commands.
 */

export class CursorCommandBuilder {
  private args: string[] = [];

  /**
   * Always use print mode for headless operation
   */
  withPrintMode(): this {
    this.args.push('-p');
    return this;
  }

  /**
   * Set output format
   */
  withOutputFormat(format: 'text' | 'json' | 'stream-json'): this {
    this.args.push('--output-format', format);
    return this;
  }

  /**
   * Set model
   */
  withModel(model: string): this {
    this.args.push('-m', model);
    return this;
  }

  /**
   * Resume existing session
   */
  withResume(sessionId: string): this {
    this.args.push('--resume', sessionId);
    return this;
  }

  /**
   * Enable streaming
   */
  withStreamPartialOutput(): this {
    this.args.push('--stream-partial-output');
    return this;
  }

  /**
   * Force allow (permission mode)
   */
  withForce(): this {
    this.args.push('-f');
    return this;
  }

  /**
   * Add prompt (must be last)
   */
  withPrompt(prompt: string): this {
    this.args.push(prompt);
    return this;
  }

  /**
   * Build final command array
   */
  build(): string[] {
    return this.args;
  }

  /**
   * Build as shell command string (for logging)
   */
  buildCommandString(): string {
    return `cursor-agent ${this.args.map((arg) => {
      // Quote args with spaces
      return arg.includes(' ') ? `"${arg}"` : arg;
    }).join(' ')}`;
  }
}
