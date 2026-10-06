-- The log becomes writable, and only in one direction.
--
-- `activity_events` and its read policy have existed since 0001; nothing has
-- ever been able to put a row in it. Two obligations rest on that changing.
-- D14 accepts that record field values sit readable in the database, and one of
-- the things it takes on in exchange is that every reveal of a masked value is
-- written here. D19 requires the same of every access made during an emergency
-- window. Both are promises about a log nobody can quietly edit afterwards.
--
-- INSERT only. No update, no delete, and no grant for either — not for the
-- admin, not for anybody. The value of a log is entirely in somebody who did
-- something being unable to remove the line that says so, and a policy that
-- allowed deletion "for cleanup" would end that in one migration.
--
-- The actor is taken from the transaction rather than from the row. A log whose
-- author can choose whose name appears on an entry is not a log.

grant insert on activity_events to safehouse_app;
--> statement-breakpoint

create policy activity_events_write on activity_events for insert to safehouse_app
with check (
  -- You write as yourself. `current_app_user()` is null for a transaction that
  -- never said who was asking, and null never equals anything, so that case
  -- fails closed without needing its own clause.
  actor_user_id = public.current_app_user()
  and (
    -- Borrowed eyes are recorded, and only somebody who can borrow them can
    -- claim to have done so.
    acting_as_user_id is null
    or perm.current_user_is_admin()
  )
);
--> statement-breakpoint

do $$
declare
  offender text;
begin
  if not has_table_privilege('safehouse_app', 'activity_events', 'INSERT') then
    raise exception 'the application still cannot write the activity log';
  end if;

  select string_agg(p.privilege_type, ', ')
  into offender
  from (values ('UPDATE'), ('DELETE')) as p(privilege_type)
  where has_table_privilege('safehouse_app', 'activity_events', p.privilege_type);

  if offender is not null then
    raise exception 'the activity log is not append-only: %', offender;
  end if;

  if (
    select count(*) from pg_policy
    where polname = 'activity_events_write' and polcmd = 'a' and polwithcheck is not null
  ) <> 1 then
    raise exception 'activity_events_write is missing or has no check expression';
  end if;
end
$$;
