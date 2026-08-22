CREATE TYPE "public"."category" AS ENUM('personal', 'medical', 'business', 'financial', 'legal', 'general');--> statement-breakpoint
CREATE TYPE "public"."owner_kind" AS ENUM('person', 'business', 'household');--> statement-breakpoint
CREATE TYPE "public"."parent_type" AS ENUM('biological', 'adoptive', 'step', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."relationship_kind" AS ENUM('parent_of', 'spouse_of');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'individual', 'third_party', 'emergency');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"acting_as_user_id" uuid,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"formed_on" date
);
--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"mime" text NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_files_page_unique" UNIQUE("document_id","page_no")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"document_date" date,
	"issued_on" date,
	"expires_on" date,
	"issuer_country" text,
	"identifier" text,
	"place_of_issue" text,
	"original_location_note" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_version_unique" UNIQUE("record_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "emergency_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "grant_categories" (
	"user_id" uuid NOT NULL,
	"category" "category" NOT NULL,
	CONSTRAINT "grant_categories_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "grant_owners" (
	"user_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	CONSTRAINT "grant_owners_user_id_owner_id_pk" PRIMARY KEY("user_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "grant_records" (
	"user_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	CONSTRAINT "grant_records_user_id_record_id_pk" PRIMARY KEY("user_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"delivered_channels" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "owner_kind" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "people" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"given_name" text NOT NULL,
	"family_name" text NOT NULL,
	"born_on" date,
	"died_on" date
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"category" "category" NOT NULL,
	"subcategory_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_owner_id" uuid NOT NULL,
	"to_owner_id" uuid NOT NULL,
	"kind" "relationship_kind" NOT NULL,
	"parent_type" "parent_type",
	"started_on" date,
	"ended_on" date,
	CONSTRAINT "relationship_not_self" CHECK ("relationships"."from_owner_id" <> "relationships"."to_owner_id"),
	CONSTRAINT "parent_type_matches_kind" CHECK (("relationships"."kind" = 'parent_of' and "relationships"."parent_type" is not null) or ("relationships"."kind" = 'spouse_of' and "relationships"."parent_type" is null))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"emergency_window_hours" integer DEFAULT 24 NOT NULL,
	"expiry_reminder_lead_days" integer DEFAULT 60 NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "category" NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "subcategories_slug_unique" UNIQUE("category","slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"person_owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_acting_as_user_id_users_id_fk" FOREIGN KEY ("acting_as_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_activations" ADD CONSTRAINT "emergency_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_activations" ADD CONSTRAINT "emergency_activations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_categories" ADD CONSTRAINT "grant_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_owners" ADD CONSTRAINT "grant_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_owners" ADD CONSTRAINT "grant_owners_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_records" ADD CONSTRAINT "grant_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_records" ADD CONSTRAINT "grant_records_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_subcategory_id_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."subcategories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_owner_id_owners_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_owner_id_owners_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_person_owner_id_owners_id_fk" FOREIGN KEY ("person_owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity_events" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_one_current" ON "documents" USING btree ("record_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "documents" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "emergency_active_idx" ON "emergency_activations" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "records_owner_idx" ON "records" USING btree ("owner_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_active_unique" ON "relationships" USING btree ("from_owner_id","to_owner_id","kind") WHERE ended_on is null;--> statement-breakpoint
CREATE INDEX "relationships_to_idx" ON "relationships" USING btree ("to_owner_id","kind");