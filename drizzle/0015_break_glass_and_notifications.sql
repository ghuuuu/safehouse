-- Break-glass becomes possible, and notifications get a writer (Step 17, D19,
-- D13, D30, D37).
--
-- **Opening a window.** `emergency_activations` has had a read policy and no
-- writer since 0001; the fixture was the only thing that ever opened a window.
-- The emergency contact opens their own, because the feature exists for the day
-- the admin cannot be reached. Everything that keeps that from being a skeleton
-- key is in the check below: only an emergency contact, only for themselves,
-- stamped now, not already revoked, with a reason, and no longer than the
-- household's setting (which itself never exceeds the ceiling in code, 0014).
--
-- **Closing one.** An admin sets `revoked_at` and `revoked_by` (their own id,
-- checked) and nothing else. Nobody can move `expires_at`, so nobody can extend
-- a window, and nothing is ever deleted.
--
-- **The alert.** A trigger writes an `emergency.activated` notification to every
-- active admin in the same transaction as the opening. It is in the database
-- rather than the application so that no code path can open a window without
-- alerting, and so the application cannot forge an alert either: the insert
-- policy below allows it to write only `expiry.soon`.
--
-- **Notifications.** The delivery sweep writes `expiry.soon` rows as the
-- recipient, about a document the recipient can see, once per document. The
-- recipient may record delivery, failure and reading on their own rows, and
-- nothing else. `delivery_error` is short on purpose: it holds "HTTP 502" or
-- "timed out", never a response body.

create function perm.current_user_is_emergency() returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from perm.app_user a
    where a.id = public.current_app_user() and a.role = 'emergency'
  )
$$;
--> statement-breakpoint
revoke all on function perm.current_user_is_emergency() from public;
--> statement-breakpoint
grant execute on function perm.current_user_is_emergency() to safehouse_app;
--> statement-breakpoint

grant insert on emergency_activations to safehouse_app;
--> statement-breakpoint
grant update (revoked_at, revoked_by) on emergency_activations to safehouse_app;
--> statement-breakpoint

create policy emergency_activations_open on emergency_activations for insert to safehouse_app
with check (
  perm.current_user_is_emergency()
  and user_id = public.current_app_user()
  and activated_at = now()
  and revoked_at is null
  and revoked_by is null
  and char_length(btrim(coalesce(reason, ''))) between 3 and 500
  and expires_at > now()
  and expires_at <= now() + make_interval(
    hours => (select s.emergency_window_hours from public.settings s where s.id = 1)
  )
);
--> statement-breakpoint

create policy emergency_activations_revoke on emergency_activations for update to safehouse_app
using (perm.current_user_is_admin() and revoked_at is null)
with check (
  perm.current_user_is_admin()
  and revoked_at is not null
  and revoked_by = public.current_app_user()
);
--> statement-breakpoint

alter table notifications add column delivered_at timestamp with time zone;
--> statement-breakpoint
alter table notifications add column delivery_attempts integer not null default 0;
--> statement-breakpoint
alter table notifications add column delivery_error text;
--> statement-breakpoint
alter table notifications add constraint notifications_error_is_short
  check (delivery_error is null or char_length(delivery_error) <= 80);
--> statement-breakpoint
create unique index notifications_expiry_once on notifications (user_id, subject_id)
  where kind = 'expiry.soon';
--> statement-breakpoint

grant insert on notifications to safehouse_app;
--> statement-breakpoint
grant update (read_at, delivered_at, delivery_attempts, delivery_error) on notifications to safehouse_app;
--> statement-breakpoint

create policy notifications_write on notifications for insert to safehouse_app
with check (
  user_id = public.current_app_user()
  and kind = 'expiry.soon'
  and subject_type = 'document'
  and subject_id = any (array(select perm.visible_document_ids()))
  and delivered_at is null
  and delivery_attempts = 0
  and delivery_error is null
  and read_at is null
);
--> statement-breakpoint

create policy notifications_update on notifications for update to safehouse_app
using (user_id = public.current_app_user())
with check (user_id = public.current_app_user());
--> statement-breakpoint

create function public.alert_admins_of_emergency() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.notifications (user_id, kind, subject_type, subject_id)
  select u.id, 'emergency.activated', 'user', new.user_id
  from public.users u
  where u.role = 'admin' and u.disabled_at is null;
  return new;
end
$$;
--> statement-breakpoint
revoke all on function public.alert_admins_of_emergency() from public;
--> statement-breakpoint
create trigger emergency_alerts_admins
  after insert on emergency_activations
  for each row execute function public.alert_admins_of_emergency();
--> statement-breakpoint

do $$
declare
  offender text;
begin
  -- The whole write surface, restated (0009 explains why).
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

  -- Column grants, not table grants: nobody can move expires_at, or rewrite
  -- what a notification is about.
  if has_column_privilege('safehouse_app', 'emergency_activations', 'expires_at', 'UPDATE')
     or has_column_privilege('safehouse_app', 'emergency_activations', 'user_id', 'UPDATE')
     or has_column_privilege('safehouse_app', 'notifications', 'subject_id', 'UPDATE')
     or has_column_privilege('safehouse_app', 'notifications', 'user_id', 'UPDATE')
     or has_column_privilege('safehouse_app', 'notifications', 'kind', 'UPDATE') then
    raise exception 'a column that must not change is updatable';
  end if;

  if has_function_privilege('safehouse_app', 'public.alert_admins_of_emergency()', 'execute')
     or has_function_privilege('safehouse_auth', 'public.alert_admins_of_emergency()', 'execute') then
    raise exception 'the alert trigger function is callable directly';
  end if;
end
$$;
