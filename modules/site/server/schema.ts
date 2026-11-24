import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const siteHomeSections = sqliteTable('site_home_sections', {
  sectionKey: text('section_key').primaryKey(),
  title: text('title').notNull(),
  visible: integer('visible', { mode: 'boolean' }).notNull(),
  sortOrder: integer('sort_order').notNull(),
  sourceMode: text('source_mode', { enum: ['latest', 'manual'] }).notNull(),
  maxItems: integer('max_items').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const siteHomeItems = sqliteTable('site_home_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sectionKey: text('section_key')
    .notNull()
    .references(() => siteHomeSections.sectionKey, { onDelete: 'cascade' }),
  itemKind: text('item_kind', { enum: ['post', 'gallery', 'project', 'experience'] }).notNull(),
  itemId: text('item_id').notNull(),
  visible: integer('visible', { mode: 'boolean' }).notNull(),
  sortOrder: integer('sort_order').notNull(),
}, table => [
  uniqueIndex('site_home_items_section_kind_item_unique').on(table.sectionKey, table.itemKind, table.itemId),
  index('site_home_items_section_order_idx').on(table.sectionKey, table.sortOrder, table.id),
])
