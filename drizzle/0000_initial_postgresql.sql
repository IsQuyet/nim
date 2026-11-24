CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" text PRIMARY KEY NOT NULL,
	"media_id" text NOT NULL,
	"title" text NOT NULL,
	"caption" text NOT NULL,
	"location" text NOT NULL,
	"taken_at" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"published_at" text
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"original_name" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "media_assets_type_check" CHECK ("media_assets"."media_type" in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')),
	CONSTRAINT "media_assets_byte_size_check" CHECK ("media_assets"."byte_size" > 0 and "media_assets"."byte_size" <= 10485760),
	CONSTRAINT "media_assets_dimensions_check" CHECK ("media_assets"."width" > 0 and "media_assets"."height" > 0 and "media_assets"."width"::bigint * "media_assets"."height"::bigint <= 40000000),
	CONSTRAINT "media_assets_state_check" CHECK ("media_assets"."state" in ('pending', 'ready'))
);
--> statement-breakpoint
CREATE TABLE "post_drafts" (
	"post_id" text PRIMARY KEY NOT NULL,
	"revision_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_publication_media" (
	"post_id" text NOT NULL,
	"publication_id" integer NOT NULL,
	"media_id" text NOT NULL,
	CONSTRAINT "post_publication_media_pk" PRIMARY KEY("post_id","publication_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "post_publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"revision_id" integer NOT NULL,
	"published_at" text NOT NULL,
	CONSTRAINT "post_publications_post_id_id_unique" UNIQUE("post_id","id"),
	CONSTRAINT "post_publications_post_id_revision_id_id_unique" UNIQUE("post_id","revision_id","id")
);
--> statement-breakpoint
CREATE TABLE "post_published" (
	"post_id" text PRIMARY KEY NOT NULL,
	"publication_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL,
	"source" text NOT NULL,
	"restored_from_revision_id" integer,
	CONSTRAINT "post_revisions_post_id_id_unique" UNIQUE("post_id","id"),
	CONSTRAINT "post_revisions_source_check" CHECK ("post_revisions"."source" in ('create', 'save', 'publish', 'import', 'restore', 'migration')),
	CONSTRAINT "post_revisions_restore_check" CHECK (("post_revisions"."source" = 'restore') = ("post_revisions"."restored_from_revision_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "post_write_receipts" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"revision_id" integer NOT NULL,
	"publication_id" integer
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_home_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_key" text NOT NULL,
	"item_kind" text NOT NULL,
	"item_id" text NOT NULL,
	"visible" boolean NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_home_sections" (
	"section_key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"visible" boolean NOT NULL,
	"sort_order" integer NOT NULL,
	"source_mode" text NOT NULL,
	"max_items" integer NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_post_id_revision_id_post_revisions_post_id_id_fk" FOREIGN KEY ("post_id","revision_id") REFERENCES "public"."post_revisions"("post_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_publication_media" ADD CONSTRAINT "post_publication_media_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_publication_media" ADD CONSTRAINT "post_publication_media_post_id_publication_id_post_publications_post_id_id_fk" FOREIGN KEY ("post_id","publication_id") REFERENCES "public"."post_publications"("post_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_publications" ADD CONSTRAINT "post_publications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_publications" ADD CONSTRAINT "post_publications_post_id_revision_id_post_revisions_post_id_id_fk" FOREIGN KEY ("post_id","revision_id") REFERENCES "public"."post_revisions"("post_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_published" ADD CONSTRAINT "post_published_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_published" ADD CONSTRAINT "post_published_post_id_publication_id_post_publications_post_id_id_fk" FOREIGN KEY ("post_id","publication_id") REFERENCES "public"."post_publications"("post_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_restored_from_revision_id_post_revisions_post_id_id_fk" FOREIGN KEY ("post_id","restored_from_revision_id") REFERENCES "public"."post_revisions"("post_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_write_receipts" ADD CONSTRAINT "post_write_receipts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_write_receipts" ADD CONSTRAINT "post_write_receipts_post_id_revision_id_post_revisions_post_id_id_fk" FOREIGN KEY ("post_id","revision_id") REFERENCES "public"."post_revisions"("post_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_write_receipts" ADD CONSTRAINT "post_write_receipts_post_id_revision_id_publication_id_post_publications_post_id_revision_id_id_fk" FOREIGN KEY ("post_id","revision_id","publication_id") REFERENCES "public"."post_publications"("post_id","revision_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_home_items" ADD CONSTRAINT "site_home_items_section_key_site_home_sections_section_key_fk" FOREIGN KEY ("section_key") REFERENCES "public"."site_home_sections"("section_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "gallery_items_media_id_idx" ON "gallery_items" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "gallery_items_status_published_at_idx" ON "gallery_items" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "post_publication_media_media_id_idx" ON "post_publication_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "post_revisions_history_idx" ON "post_revisions" USING btree ("post_id","created_at","id");--> statement-breakpoint
CREATE INDEX "post_write_receipts_post_id_idx" ON "post_write_receipts" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_home_items_section_kind_item_unique" ON "site_home_items" USING btree ("section_key","item_kind","item_id");--> statement-breakpoint
CREATE INDEX "site_home_items_section_order_idx" ON "site_home_items" USING btree ("section_key","sort_order","id");