-- F097: resumable media upload sessions. Chunk bytes are staged on disk under
-- MEDIA_DIR/.uploads; this table tracks ownership, progress and expiry only.
CREATE TABLE "media_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"total_size" bigint NOT NULL,
	"chunk_size" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"storage_driver" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"key" text NOT NULL,
	"uploaded_chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_uploads_status_check" CHECK (("media_uploads"."status" in ('uploading', 'completed', 'aborted', 'expired'))),
	CONSTRAINT "media_uploads_chunk_math" CHECK (("media_uploads"."total_size" > 0 and "media_uploads"."chunk_size" > 0 and "media_uploads"."total_chunks" > 0))
);
--> statement-breakpoint
CREATE INDEX "idx_media_uploads_status_expires" ON "media_uploads" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_media_uploads_user" ON "media_uploads" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint