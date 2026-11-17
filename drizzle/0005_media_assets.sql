CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`original_name` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sha256` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "media_assets_type_check" CHECK("media_assets"."media_type" in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')),
	CONSTRAINT "media_assets_byte_size_check" CHECK("media_assets"."byte_size" > 0 and "media_assets"."byte_size" <= 10485760),
	CONSTRAINT "media_assets_dimensions_check" CHECK("media_assets"."width" > 0 and "media_assets"."height" > 0 and "media_assets"."width" * "media_assets"."height" <= 40000000),
	CONSTRAINT "media_assets_state_check" CHECK("media_assets"."state" in ('pending', 'ready'))
);
--> statement-breakpoint
CREATE TABLE `post_publication_media` (
	`post_id` text NOT NULL,
	`publication_id` integer NOT NULL,
	`media_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `publication_id`, `media_id`),
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`post_id`,`publication_id`) REFERENCES `post_publications`(`post_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_publication_media_media_id_idx` ON `post_publication_media` (`media_id`);