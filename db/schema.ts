import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const calls = sqliteTable('calls', {
  encounterId: text('encounter_id').primaryKey(),
  marks: text('marks').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  role: text('role').notNull(),
  display: text('display').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
