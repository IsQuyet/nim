import { customType, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const date = customType<{ data: Date; driverData: string }>({
  dataType: () => 'date',
  toDriver: value => value.toISOString(),
  fromDriver: value => new Date(value),
})

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
