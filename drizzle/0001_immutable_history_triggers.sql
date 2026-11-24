CREATE OR REPLACE FUNCTION reject_immutable_post_history()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0];
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER post_revisions_immutable
BEFORE UPDATE ON post_revisions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_post_history('Post revisions are immutable');
--> statement-breakpoint
CREATE TRIGGER post_publications_immutable
BEFORE UPDATE ON post_publications
FOR EACH ROW EXECUTE FUNCTION reject_immutable_post_history('Post publications are immutable');
--> statement-breakpoint
CREATE TRIGGER post_write_receipts_immutable
BEFORE UPDATE ON post_write_receipts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_post_history('Post write receipts are immutable');
