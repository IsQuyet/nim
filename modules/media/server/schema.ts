import { sql } from 'drizzle-orm'
import { check, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { MAX_MEDIA_IMAGE_PIXELS, MAX_MEDIA_UPLOAD_BYTES, mediaStateSchema, mediaTypeSchema, type MediaAsset } from '../model'

export const mediaAssets = pgTable('media_assets', {
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
  check('media_assets_dimensions_check', sql`${table.width} > 0 and ${table.height} > 0 and ${table.width}::bigint * ${table.height}::bigint <= ${sql.raw(String(MAX_MEDIA_IMAGE_PIXELS))}`),
  check('media_assets_state_check', sql`${table.state} in (${sql.raw(mediaStateSchema.options.map(state => `'${state}'`).join(', '))})`),
])
