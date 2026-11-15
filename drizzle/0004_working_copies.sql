CREATE TABLE `post_working_copies` (
	`post_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `post_write_receipts` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`version` text NOT NULL,
	`revision_id` integer,
	`updated_at` text NOT NULL,
	`publication_id` integer,
	`published_at` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`,`revision_id`) REFERENCES `post_revisions`(`post_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`,`publication_id`) REFERENCES `post_publications`(`post_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "post_write_receipts_publication_check" CHECK(("post_write_receipts"."publication_id" is null) = ("post_write_receipts"."published_at" is null))
);
--> statement-breakpoint
CREATE INDEX `post_write_receipts_post_id_idx` ON `post_write_receipts` (`post_id`);
--> statement-breakpoint
INSERT INTO `post_working_copies` (`post_id`, `version`, `title`, `description`, `body`, `updated_at`)
SELECT d.`post_id`, lower(hex(randomblob(16))), r.`title`, r.`description`, r.`body`, r.`created_at`
FROM `post_drafts` d JOIN `post_revisions` r ON r.`id` = d.`revision_id`;
--> statement-breakpoint
CREATE TRIGGER `post_write_receipts_immutable`
BEFORE UPDATE ON `post_write_receipts`
BEGIN
  SELECT RAISE(ABORT, 'Post write receipts are immutable');
END;