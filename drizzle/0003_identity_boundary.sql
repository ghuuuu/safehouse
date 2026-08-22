-- The identity boundary (D24).
--
-- Signing in is the one operation that has to happen before anyone knows who is
-- asking: the password has to be checked against a row that has not been
-- identified yet. That is exactly the shape row-level security cannot express,
-- so it is given its own connection instead.
--
--   safehouse_auth  reads and writes users, sessions, accounts, verifications.
--                   It has no privilege of any kind on records, documents,
--                   files, or anything else in the vault.
--   safehouse_app   reads the vault under the policies in 0001. It cannot read
--                   the accounts table at all, so a password hash cannot come
--                   back through an ordinary query even by accident.
--
-- The two halves meet in one place: once sign-in has produced a user id, the
-- request opens a vault transaction as safehouse_app and names that user.

-- Start from nothing. If a later migration adds a table, the auth role gets no
-- access to it unless somebody writes the grant down here on purpose.
revoke all on all tables in schema public from safehouse_auth;
--> statement-breakpoint

grant select, insert, update, delete on users, sessions, accounts, verifications to safehouse_auth;
--> statement-breakpoint

-- The password hash and the session tokens are not the application's business.
-- `users` stays readable by the app, under the policy written in 0001.
revoke all on accounts, sessions, verifications from safehouse_app;
--> statement-breakpoint

alter table sessions enable row level security;
--> statement-breakpoint
alter table accounts enable row level security;
--> statement-breakpoint
alter table verifications enable row level security;
--> statement-breakpoint

-- Row-level security is on for these three so that the guardrail test — every
-- table in the schema has it — keeps holding. The auth role needs all four
-- unfiltered, and gets them one table at a time rather than by exemption.
create policy users_auth on users for all to safehouse_auth using (true) with check (true);
--> statement-breakpoint
create policy sessions_auth on sessions for all to safehouse_auth using (true) with check (true);
--> statement-breakpoint
create policy accounts_auth on accounts for all to safehouse_auth using (true) with check (true);
--> statement-breakpoint
create policy verifications_auth on verifications for all to safehouse_auth using (true) with check (true);
--> statement-breakpoint

-- A user who is not somebody in the tree is not a member of the household.
--
-- As first written, this branch handed every account with the `individual` role
-- the household's own papers — the deed, the marriage certificate. That is the
-- right answer for a family member and the wrong one for a row that merely
-- exists, which is what an account is between being created and being attached
-- to a person. Requiring the link means a half-finished account sees nothing.
create or replace view visible_owner as
select a.id as user_id, o.id as owner_id
from app_user a
cross join owners o
where a.role = 'admin'
union
select fc.user_id, fc.owner_id
from family_circle fc
union
select a.id, o.id
from app_user a
cross join owners o
where a.role = 'individual'
  and a.person_owner_id is not null
  and o.kind = 'household'
union
select g.user_id, g.owner_id
from grant_owners g
join app_user a on a.id = g.user_id
union
select a.id, o.id
from app_user a
join active_emergency e on e.user_id = a.id
cross join owners o
where a.role = 'emergency';
