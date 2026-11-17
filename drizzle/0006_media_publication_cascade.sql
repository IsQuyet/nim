PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_post_publication_media` (
	`post_id` text NOT NULL,
	`publication_id` integer NOT NULL,
	`media_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `publication_id`, `media_id`),
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`post_id`,`publication_id`) REFERENCES `post_publications`(`post_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_post_publication_media`("post_id", "publication_id", "media_id") SELECT "post_id", "publication_id", "media_id" FROM `post_publication_media`;--> statement-breakpoint
DROP TABLE `post_publication_media`;--> statement-breakpoint
ALTER TABLE `__new_post_publication_media` RENAME TO `post_publication_media`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `post_publication_media_media_id_idx` ON `post_publication_media` (`media_id`);