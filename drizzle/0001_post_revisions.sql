CREATE TABLE `post_drafts` (
	`post_id` text PRIMARY KEY NOT NULL,
	`revision_id` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`,`revision_id`) REFERENCES `post_revisions`(`post_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `post_publications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` text NOT NULL,
	`revision_id` integer NOT NULL,
	`published_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`,`revision_id`) REFERENCES `post_revisions`(`post_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_publications_post_id_id_unique` ON `post_publications` (`post_id`,`id`);--> statement-breakpoint
CREATE TABLE `post_published` (
	`post_id` text PRIMARY KEY NOT NULL,
	`publication_id` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`,`publication_id`) REFERENCES `post_publications`(`post_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `post_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`source` text NOT NULL,
	`restored_from_revision_id` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`,`restored_from_revision_id`) REFERENCES `post_revisions`(`post_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "post_revisions_source_check" CHECK("post_revisions"."source" in ('create', 'save', 'publish', 'import', 'restore', 'migration')),
	CONSTRAINT "post_revisions_restore_check" CHECK(("post_revisions"."source" = 'restore') = ("post_revisions"."restored_from_revision_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_revisions_post_id_id_unique` ON `post_revisions` (`post_id`,`id`);
--> statement-breakpoint
INSERT INTO `post_revisions` (`id`, `post_id`, `title`, `description`, `body`, `created_at`, `source`)
SELECT `rowid`, `post_id`, `title`, `description`, `body`, `updated_at`, 'migration'
FROM `post_contents`;
--> statement-breakpoint
INSERT INTO `post_drafts` (`post_id`, `revision_id`)
SELECT `post_id`, `rowid` FROM `post_contents` WHERE `stage` = 'draft';
--> statement-breakpoint
INSERT INTO `post_publications` (`post_id`, `revision_id`, `published_at`)
SELECT `post_id`, `rowid`, `updated_at` FROM `post_contents` WHERE `stage` = 'published';
--> statement-breakpoint
INSERT INTO `post_published` (`post_id`, `publication_id`)
SELECT `post_id`, `id` FROM `post_publications`;
--> statement-breakpoint
CREATE TRIGGER `post_revisions_immutable` BEFORE UPDATE ON `post_revisions`
BEGIN SELECT RAISE(ABORT, 'Post revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `post_publications_immutable` BEFORE UPDATE ON `post_publications`
BEGIN SELECT RAISE(ABORT, 'Post publications are immutable'); END;