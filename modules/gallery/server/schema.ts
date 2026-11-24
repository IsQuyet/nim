import { index, pgTable, text } from 'drizzle-orm/pg-core'
import { mediaAssets } from '@/modules/media/server/schema'

export const galleryItems = pgTable('gallery_items', {
  id: text('id').primaryKey(),
  mediaId: text('media_id')
    .notNull()
    .references(() => mediaAssets.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  caption: text('caption').notNull(),
  location: text('location').notNull(),
  takenAt: text('taken_at'),
  status: text('status', { enum: ['draft', 'published'] }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  publishedAt: text('published_at'),
}, table => [
  index('gallery_items_media_id_idx').on(table.mediaId),
  index('gallery_items_status_published_at_idx').on(table.status, table.publishedAt),
])
