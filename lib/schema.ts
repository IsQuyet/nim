import { sql } from 'drizzle-orm'
import { check, customType, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { revisionSources, revisionSourceSchema } from '@/modules/posts/model'
import { MAX_MEDIA_IMAGE_PIXELS, MAX_MEDIA_UPLOAD_BYTES, mediaStateSchema, mediaTypeSchema, type MediaAsset } from '@/modules/media/model'

const date = customType<{ data: Date; driverData: string }>({
  dataType: () => 'date',
  toDriver: value => value.toISOString(),
  fromDriver: value => new Date(value),
})

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
})

export const postRevisions = sqliteTable('post_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  source: text('source', { enum: revisionSources }).notNull(),
  restoredFromRevisionId: integer('restored_from_revision_id'),
}, table => [
  unique('post_revisions_post_id_id_unique').on(table.postId, table.id),
  index('post_revisions_history_idx').on(table.postId, table.createdAt, table.id),
  foreignKey({
    columns: [table.postId, table.restoredFromRevisionId],
    foreignColumns: [table.postId, table.id],
  }),
  check('post_revisions_source_check', sql`${table.source} in (${sql.raw(revisionSourceSchema.options.map(source => `'${source}'`).join(', '))})`),
  check('post_revisions_restore_check', sql`(${table.source} = ${sql.raw(`'${revisionSourceSchema.enum.restore}'`)}) = (${table.restoredFromRevisionId} is not null)`),
])

export const postDrafts = sqliteTable('post_drafts', {
  postId: text('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  revisionId: integer('revision_id').notNull(),
}, table => [
  foreignKey({
    columns: [table.postId, table.revisionId],
    foreignColumns: [postRevisions.postId, postRevisions.id],
  }),
])

export const postWriteReceipts = sqliteTable('post_write_receipts', {
  operationId: text('operation_id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  requestHash: text('request_hash').notNull(),
  revisionId: integer('revision_id').notNull(),
  publicationId: integer('publication_id'),
}, table => [
  index('post_write_receipts_post_id_idx').on(table.postId),
  foreignKey({
    columns: [table.postId, table.revisionId],
    foreignColumns: [postRevisions.postId, postRevisions.id],
  }),
  foreignKey({
    columns: [table.postId, table.revisionId, table.publicationId],
    foreignColumns: [postPublications.postId, postPublications.revisionId, postPublications.id],
  }),
])

export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  originalName: text('original_name').notNull(),
  mediaType: text('media_type').$type<MediaAsset['mediaType']>().notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sha256: text('sha256').notNull(),
  state: text('state').$type<MediaAsset['state']>().notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  check('media_assets_type_check', sql`${table.mediaType} in (${sql.raw(mediaTypeSchema.options.map(type => `'${type}'`).join(', '))})`),
  check('media_assets_byte_size_check', sql`${table.byteSize} > 0 and ${table.byteSize} <= ${sql.raw(String(MAX_MEDIA_UPLOAD_BYTES))}`),
  check('media_assets_dimensions_check', sql`${table.width} > 0 and ${table.height} > 0 and ${table.width} * ${table.height} <= ${sql.raw(String(MAX_MEDIA_IMAGE_PIXELS))}`),
  check('media_assets_state_check', sql`${table.state} in (${sql.raw(mediaStateSchema.options.map(state => `'${state}'`).join(', '))})`),
])

export const postPublications = sqliteTable('post_publications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  revisionId: integer('revision_id').notNull(),
  publishedAt: text('published_at').notNull(),
}, table => [
  unique('post_publications_post_id_id_unique').on(table.postId, table.id),
  unique('post_publications_post_id_revision_id_id_unique').on(table.postId, table.revisionId, table.id),
  foreignKey({
    columns: [table.postId, table.revisionId],
    foreignColumns: [postRevisions.postId, postRevisions.id],
  }),
])

export const postPublicationMedia = sqliteTable('post_publication_media', {
  postId: text('post_id').notNull(),
  publicationId: integer('publication_id').notNull(),
  mediaId: text('media_id').notNull().references(() => mediaAssets.id, { onDelete: 'restrict' }),
}, table => [
  primaryKey({ name: 'post_publication_media_pk', columns: [table.postId, table.publicationId, table.mediaId] }),
  index('post_publication_media_media_id_idx').on(table.mediaId),
  foreignKey({
    columns: [table.postId, table.publicationId],
    foreignColumns: [postPublications.postId, postPublications.id],
  }).onDelete('cascade'),
])

export const postPublished = sqliteTable('post_published', {
  postId: text('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  publicationId: integer('publication_id').notNull(),
}, table => [
  foreignKey({
    columns: [table.postId, table.publicationId],
    foreignColumns: [postPublications.postId, postPublications.id],
  }),
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
