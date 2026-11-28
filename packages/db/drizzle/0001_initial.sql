-- v2 consolidated baseline. Fresh installs apply this file only. `citext`
-- backs the case-insensitive UNIQUE email (architecture 2.5 item 4).
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."auth_token_type" AS ENUM('verify', 'reset', 'mfa');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'learner');--> statement-breakpoint
CREATE TYPE "public"."video_mode" AS ENUM('inherit', 'custom', 'none');--> statement-breakpoint
CREATE SEQUENCE "public"."course_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" integer,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"course_id" text NOT NULL,
	"idx" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "chapters_pkey" PRIMARY KEY("course_id","idx")
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY DEFAULT 'C' || nextval('course_seq') NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"teacher" text NOT NULL,
	"level" text NOT NULL,
	"badge" text,
	"color" text,
	"intro" text,
	"video_mode" "video_mode" DEFAULT 'inherit' NOT NULL,
	"video" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"id_num" integer GENERATED ALWAYS AS ((nullif(regexp_replace(id, '[^0-9]', '', 'g'), ''))::integer) STORED,
	CONSTRAINT "courses_video_mode_payload" CHECK ((("courses"."video_mode" = 'custom') = ("courses"."video" is not null))),
	CONSTRAINT "courses_color_format" CHECK ("courses"."color" is null or "courses"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "dataset_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual-import' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "knowledge" (
	"course_id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"row_count" integer NOT NULL,
	"rows" jsonb NOT NULL,
	CONSTRAINT "record_snapshots_row_count_non_negative" CHECK ("record_snapshots"."row_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"course_id" text NOT NULL,
	"learning_date" date NOT NULL,
	"learning_minutes" integer NOT NULL,
	"chapters_done" integer NOT NULL,
	"total_chapters" integer NOT NULL,
	"quiz_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_student_id_length" CHECK (char_length("records"."student_id") between 1 and 32),
	CONSTRAINT "records_learning_minutes_range" CHECK ("records"."learning_minutes" between 0 and 1440),
	CONSTRAINT "records_chapters_done_non_negative" CHECK ("records"."chapters_done" >= 0),
	CONSTRAINT "records_total_chapters_positive" CHECK ("records"."total_chapters" > 0),
	CONSTRAINT "records_chapters_within_total" CHECK ("records"."chapters_done" <= "records"."total_chapters"),
	CONSTRAINT "records_quiz_score_range" CHECK ("records"."quiz_score" is null or ("records"."quiz_score" >= 0 and "records"."quiz_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'learner' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"email_verified" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"mfa_secret" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_failed_attempts_non_negative" CHECK ("users"."failed_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_user" ON "auth_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_expires" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_name_unique" ON "courses" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_courses_sort" ON "courses" USING btree ("sort_order","id_num","id");--> statement-breakpoint
CREATE INDEX "idx_dataset_imports_created" ON "dataset_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_recovery_user" ON "mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_record_snapshots_created" ON "record_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_records_course" ON "records" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_records_student" ON "records" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_records_date" ON "records" USING btree ("learning_date");--> statement-breakpoint
CREATE INDEX "idx_records_listing" ON "records" USING btree ("learning_date" desc,"student_id","id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
-- Read model for API/CSV responses: records keep `course_id` only (ADR-007),
-- while callers still receive the current `course_name`.
CREATE VIEW "public"."records_with_course_name" AS
SELECT
	"r"."id" AS "id",
	"r"."student_id" AS "student_id",
	"r"."course_id" AS "course_id",
	"c"."name" AS "course_name",
	"r"."learning_date" AS "learning_date",
	"r"."learning_minutes" AS "learning_minutes",
	"r"."chapters_done" AS "chapters_done",
	"r"."total_chapters" AS "total_chapters",
	"r"."quiz_score" AS "quiz_score",
	"r"."created_at" AS "created_at"
FROM "records" "r"
JOIN "courses" "c" ON "c"."id" = "r"."course_id";