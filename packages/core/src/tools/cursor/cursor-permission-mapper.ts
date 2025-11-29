/**
 * Permission Mode Mapper
 *
 * Maps Agor permission modes to Cursor CLI flags.
 * Cursor has simpler binary mode: default (prompts) or -f/--force (auto-allow).
 */

/**
 * Agor permission modes (simplified for Cursor)
 */
export type PermissionMode = 'ask' | 'auto' | 'allow-all';

export class CursorPermissionMapper {
  /**
   * Map Agor permission modes to Cursor CLI flags
   *
   * Agor modes:
   * - 'ask': Prompt user for each tool (default)
   * - 'auto': Automatically approve tools
   * - 'allow-all': Allow everything
   *
   * Cursor modes:
   * - (no flag): Interactive prompts
   * - '-f, --force': Force allow commands unless explicitly denied
   */
  static mapToFlags(agorMode: PermissionMode): string[] {
    switch (agorMode) {
      case 'ask':
        return []; // No flag = interactive prompts

      case 'auto':
      case 'allow-all':
        return ['-f']; // Force allow

      default:
        console.warn(`[CursorPermissionMapper] Unknown mode: ${agorMode}, defaulting to 'ask'`);
        return [];
    }
  }

  /**
   * Get human-readable description of permission mode
   */
  static describe(agorMode: PermissionMode): string {
    switch (agorMode) {
      case 'ask':
        return 'Interactive: Prompt for each tool use';
      case 'auto':
        return 'Automatic: Approve all tools';
      case 'allow-all':
        return 'Allow all: Maximum automation';
      default:
        return 'Unknown permission mode';
    }
  }
}
