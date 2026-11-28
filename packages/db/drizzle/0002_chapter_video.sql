ALTER TABLE "chapters" ADD COLUMN "video_mode" "video_mode" DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "video" jsonb;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_video_mode_payload" CHECK ((("chapters"."video_mode" = 'custom') = ("chapters"."video" is not null)));