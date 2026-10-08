-- Identifiers stop being readable in the database (D35, replacing D14).
--
-- D14 kept passport numbers in a plain text column so that search could match
-- any part of one, and accepted that a copy of the database is a copy of every
-- number in the household. The household chose the other side of that trade:
-- a stolen volume, a leaked dump, or a role that can run `select` should get
-- nothing. These three columns replace the one:
--
--   identifier_sealed     AES-256-GCM under a key derived from the KEK.
--   identifier_fp         keyed fingerprint of the whole number.
--   identifier_last4_fp   keyed fingerprint of its last four characters.
--
-- The key is not in the database, so this migration cannot encrypt anything.
-- What it does instead is make sure nothing new is ever written in the clear:
-- the check below is NOT VALID, which means existing rows are left alone and
-- every insert and update from now on is held to it. `npm run db:migrate` then
-- runs `identifiers:seal`, which seals what is there, empties the column, and
-- validates the constraint. Dropping the column is a later migration, once
-- every deployment has sealed.

alter table documents add column identifier_sealed bytea;
--> statement-breakpoint
alter table documents add column identifier_fp bytea;
--> statement-breakpoint
alter table documents add column identifier_last4_fp bytea;
--> statement-breakpoint

-- All three or none. A sealed number nobody can search for, or a fingerprint
-- with nothing behind it, is a write that half happened.
alter table documents add constraint identifier_columns_together check (
  (identifier_sealed is null) = (identifier_fp is null)
  and (identifier_fp is null) = (identifier_last4_fp is null)
);
--> statement-breakpoint

alter table documents add constraint identifier_is_sealed check (identifier is null) not valid;
--> statement-breakpoint

create index documents_identifier_fp_idx on documents (identifier_fp) where identifier_fp is not null;
--> statement-breakpoint
create index documents_identifier_last4_fp_idx on documents (identifier_last4_fp) where identifier_last4_fp is not null;
