import { sql } from 'drizzle-orm'
import { check, customType, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const date = customType<{ data: Date; driverData: string }>({
  dataType: () => 'date',
  toDriver: value => value.toISOString(),
  fromDriver: value => new Date(value),
})

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
})

export const postContents = sqliteTable('post_contents', {
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  stage: text('stage', { enum: ['draft', 'published'] }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  body: text('body').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.postId, table.stage] }),
  check('post_contents_stage_check', sql`${table.stage} in ('draft', 'published')`),
])

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: date('createdAt').notNull(),
  updatedAt: date('updatedAt').notNull(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: date('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: date('createdAt').notNull(),
  updatedAt: date('updatedAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, table => [index('session_userId_idx').on(table.userId)])

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: date('accessTokenExpiresAt'),
  refreshTokenExpiresAt: date('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: date('createdAt').notNull(),
  updatedAt: date('updatedAt').notNull(),
}, table => [index('account_userId_idx').on(table.userId)])

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: date('expiresAt').notNull(),
  createdAt: date('createdAt').notNull(),
  updatedAt: date('updatedAt').notNull(),
}, table => [index('verification_identifier_idx').on(table.identifier)])
