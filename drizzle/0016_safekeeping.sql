-- Safekeeping (Step 19, D6, D12, D38): the vault learns whether its backups
-- are being proven and whether anybody has a copy of the key.
--
-- **Drills.** `npm run backup:drill` restores a backup into a throwaway
-- database and opens a document out of it. When it passes it writes one row
-- here, as the owner, into the live vault. The application reads the rows and
-- cannot write them: a drill that never ran must not be something the app can
-- claim. An admin reads them, so the dashboard can say when the newest backup
-- proven to restore was taken. Nobody else needs to know.
--
-- **The key copy.** An admin says the key is written down somewhere that is not
-- this machine. What is recorded is the id of the key they said it about (four
-- bytes of its hash, already in every wrapped data key), so a replaced key asks
-- again. It is a person's word, and only silences a reminder; it unlocks
-- nothing, so the existing admin-only update policy on settings is enough.

create table backup_drills (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamp with time zone not null default now(),
  backup_id text not null,
  backup_taken_at timestamp with time zone not null
);
--> statement-breakpoint
alter table backup_drills enable row level security;
--> statement-breakpoint
grant select on backup_drills to safehouse_app;
--> statement-breakpoint
create policy backup_drills_read on backup_drills for select to safehouse_app
using (perm.current_user_is_admin());
--> statement-breakpoint

alter table settings add column key_copy_confirmed_for text;
--> statement-breakpoint
alter table settings add constraint settings_key_copy_is_a_key_id
  check (key_copy_confirmed_for is null or key_copy_confirmed_for ~ '^[0-9a-f]{8}$');
--> statement-breakpoint
grant update (key_copy_confirmed_for) on settings to safehouse_app;
--> statement-breakpoint

do $$
declare
  offender text;
begin
  -- The whole write surface, restated (0009 explains why). Unchanged by this
  -- migration: backup_drills is read-only to the application.
  select string_agg(format('%s:%s', c.relname, p.privilege_type), ', ' order by c.relname)
  into offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege_type)
  where n.nspname = 'public'
    and c.relkind = 'r'
    and has_table_privilege('safehouse_app', c.oid, p.privilege_type)
    and not (
      p.privilege_type = 'INSERT'
      and c.relname in (
        'records', 'documents', 'document_files',
        'activity_events',
        'owners', 'people', 'relationships',
        'grant_owners', 'grant_categories', 'grant_records',
        'emergency_activations', 'notifications'
      )
    )
    and not (p.privilege_type = 'UPDATE' and c.relname = 'documents')
    and not (
      p.privilege_type = 'DELETE'
      and c.relname in ('grant_owners', 'grant_categories', 'grant_records')
    );

  if offender is not null then
    raise exception 'safehouse_app can write more than it should: %', offender;
  end if;

  if (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'settings_update')
     not like '%current_user_is_admin%' then
    raise exception 'settings_update no longer requires an admin';
  end if;

  if (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'backup_drills_read')
     not like '%current_user_is_admin%' then
    raise exception 'backup_drills_read no longer requires an admin';
  end if;
end
$$;
