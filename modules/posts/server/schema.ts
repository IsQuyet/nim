import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, primaryKey, serial, text, unique } from 'drizzle-orm/pg-core'
import { mediaAssets } from '@/modules/media/server/schema'
import { revisionSources, revisionSourceSchema } from '../model'

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
})

export const postRevisions = pgTable('post_revisions', {
  id: serial('id').primaryKey(),
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

export const postDrafts = pgTable('post_drafts', {
  postId: text('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  revisionId: integer('revision_id').notNull(),
}, table => [
  foreignKey({
    columns: [table.postId, table.revisionId],
    foreignColumns: [postRevisions.postId, postRevisions.id],
  }),
])

export const postWriteReceipts = pgTable('post_write_receipts', {
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

export const postPublications = pgTable('post_publications', {
  id: serial('id').primaryKey(),
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

export const postPublicationMedia = pgTable('post_publication_media', {
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

export const postPublished = pgTable('post_published', {
  postId: text('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  publicationId: integer('publication_id').notNull(),
}, table => [
  foreignKey({
    columns: [table.postId, table.publicationId],
    foreignColumns: [postPublications.postId, postPublications.id],
  }),
])
