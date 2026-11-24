import { boolean, index, integer, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

export const siteHomeSections = pgTable('site_home_sections', {
  sectionKey: text('section_key').primaryKey(),
  title: text('title').notNull(),
  visible: boolean('visible').notNull(),
  sortOrder: integer('sort_order').notNull(),
  sourceMode: text('source_mode', { enum: ['latest', 'manual'] }).notNull(),
  maxItems: integer('max_items').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const siteHomeItems = pgTable('site_home_items', {
  id: serial('id').primaryKey(),
  sectionKey: text('section_key')
    .notNull()
    .references(() => siteHomeSections.sectionKey, { onDelete: 'cascade' }),
  itemKind: text('item_kind', { enum: ['post', 'gallery', 'project', 'experience'] }).notNull(),
  itemId: text('item_id').notNull(),
  visible: boolean('visible').notNull(),
  sortOrder: integer('sort_order').notNull(),
}, table => [
  uniqueIndex('site_home_items_section_kind_item_unique').on(table.sectionKey, table.itemKind, table.itemId),
  index('site_home_items_section_order_idx').on(table.sectionKey, table.sortOrder, table.id),
])
