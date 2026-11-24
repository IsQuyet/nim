CREATE TABLE `gallery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`title` text NOT NULL,
	`caption` text NOT NULL,
	`location` text NOT NULL,
	`taken_at` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `gallery_items_media_id_idx` ON `gallery_items` (`media_id`);--> statement-breakpoint
CREATE INDEX `gallery_items_status_published_at_idx` ON `gallery_items` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `site_home_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_key` text NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` text NOT NULL,
	`visible` integer NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`section_key`) REFERENCES `site_home_sections`(`section_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_home_items_section_kind_item_unique` ON `site_home_items` (`section_key`,`item_kind`,`item_id`);--> statement-breakpoint
CREATE INDEX `site_home_items_section_order_idx` ON `site_home_items` (`section_key`,`sort_order`,`id`);--> statement-breakpoint
CREATE TABLE `site_home_sections` (
	`section_key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`visible` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`source_mode` text NOT NULL,
	`max_items` integer NOT NULL,
	`updated_at` text NOT NULL
);
