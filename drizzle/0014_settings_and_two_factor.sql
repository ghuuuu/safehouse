-- The household's settings become editable, and sign-in learns a second factor
-- (Step 16, D19, D36).
--
-- **Settings.** One row, readable by anybody signed in since 0001, writable by
-- nobody until now. Three columns become writable, by an active admin only,
-- each held to a range by a check constraint. The emergency window's ceiling is
-- the one D19 cares about: it is a constant in code (`EMERGENCY_CEILING_HOURS`
-- in app/settings.ts) and the constraint below, and `settings.test.ts` keeps
-- the two equal. A setting that could be raised without limit is not a ceiling.
--
-- **Two-factor.** better-auth's own plugin, with its own table. It is a
-- credential, like `accounts`: the auth role reads and writes it, the vault
-- role cannot see it exists. The secret is encrypted by the library before it
-- is written.

alter table settings add column auto_lock_minutes integer not null default 15;
--> statement-breakpoint
alter table settings add constraint settings_emergency_window_ceiling
  check (emergency_window_hours >= 1 and emergency_window_hours <= 72);
--> statement-breakpoint
alter table settings add constraint settings_expiry_lead_range
  check (expiry_reminder_lead_days >= 1 and expiry_reminder_lead_days <= 365);
--> statement-breakpoint
alter table settings add constraint settings_auto_lock_range
  check (auto_lock_minutes >= 5 and auto_lock_minutes <= 240);
--> statement-breakpoint

-- Column by column, so `id` (and the singleton it guards) stays out of reach.
grant update (emergency_window_hours, expiry_reminder_lead_days, auto_lock_minutes)
  on settings to safehouse_app;
--> statement-breakpoint
create policy settings_update on settings for update to safehouse_app
using (perm.current_user_is_admin())
with check (perm.current_user_is_admin());
--> statement-breakpoint

alter table users add column two_factor_enabled boolean not null default false;
--> statement-breakpoint
create table two_factors (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  backup_codes text not null,
  user_id uuid not null references users (id) on delete cascade,
  verified boolean not null default true,
  failed_verification_count integer not null default 0,
  locked_until timestamp with time zone
);
--> statement-breakpoint
create index two_factors_user_idx on two_factors (user_id);
--> statement-breakpoint

-- The default privileges in `public` hand every new table to the vault role
-- for reading (0004). This one is a credential: taken back at once, and RLS on
-- so the guardrail test (every table has it) keeps holding.
revoke all on two_factors from safehouse_app;
--> statement-breakpoint
grant select, insert, update, delete on two_factors to safehouse_auth;
--> statement-breakpoint
alter table two_factors enable row level security;
--> statement-breakpoint
create policy two_factors_auth on two_factors for all to safehouse_auth using (true) with check (true);
--> statement-breakpoint

do $$
begin
  if has_table_privilege('safehouse_app', 'two_factors', 'SELECT') then
    raise exception 'the vault role can read two-factor secrets';
  end if;
  if has_table_privilege('safehouse_app', 'settings', 'INSERT')
     or has_table_privilege('safehouse_app', 'settings', 'DELETE')
     or has_column_privilege('safehouse_app', 'settings', 'id', 'UPDATE') then
    raise exception 'the vault role can do more to settings than change three numbers';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'settings_update')
     not like '%current_user_is_admin%' then
    raise exception 'settings_update no longer requires an admin';
  end if;
end
$$;
