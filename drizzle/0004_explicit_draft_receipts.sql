CREATE TABLE `post_write_receipts` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`revision_id` integer NOT NULL,
	`publication_id` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`,`revision_id`) REFERENCES `post_revisions`(`post_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`,`revision_id`,`publication_id`) REFERENCES `post_publications`(`post_id`,`revision_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_write_receipts_post_id_idx` ON `post_write_receipts` (`post_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `post_publications_post_id_revision_id_id_unique` ON `post_publications` (`post_id`,`revision_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `post_write_receipts_immutable`
BEFORE UPDATE ON `post_write_receipts`
BEGIN
  SELECT RAISE(ABORT, 'Post write receipts are immutable');
END;