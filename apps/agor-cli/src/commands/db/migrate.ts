/**
 * `agor db migrate` - Run pending database migrations
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, runMigrations } from '@agor/core/db';
import { Command } from '@oclif/core';
import chalk from 'chalk';

export default class DbMigrate extends Command {
  static description = 'Run pending database migrations';

  static examples = ['<%= config.bin %> <%= command.id %>'];

  async run(): Promise<void> {
    try {
      // Determine database path (same logic as daemon)
      const agorHome = process.env.AGOR_HOME || join(homedir(), '.agor');
      const dbPath = process.env.AGOR_DB_PATH || `file:${join(agorHome, 'agor.db')}`;

      this.log('Running database migrations...');

      const db = createDatabase({ url: dbPath });
      await runMigrations(db);

      this.log(`${chalk.green('✓')} Database is up to date`);
    } catch (error) {
      this.error(
        `Failed to run migrations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
