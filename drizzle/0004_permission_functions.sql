-- Putting the rules out of reach of the application (D25).
--
-- 0001 left a hole. Postgres requires the querying role to hold SELECT on any
-- relation a policy expression names, so `grant select on all tables in schema
-- public to safehouse_app` had to include the permission views — and those
-- views are owned by the migrating role and read the base tables with
-- row-level security bypassed. `safehouse_app` could therefore read them
-- directly: `app_user` is every account and its role, `visible_record` is the
-- entire who-can-see-what graph. No document contents, no field values, but
-- the shape of the household and who is entitled to what.
--
-- Two independent locks, because one is a single well-meant grant away from
-- being undone:
--
--   1. The views move to a schema, `perm`, that neither restricted role has
--      USAGE on. The name no longer resolves for them at all, and no
--      schema-wide grant on `public` can ever reach them again.
--   2. SELECT on them is revoked outright. The policies stop naming the views
--      and call functions instead, so the privilege is no longer needed.
--
-- The functions are the delicate part, and each line of them is load-bearing:
--
--   * They take NO arguments. A function that accepted a user id would be an
--     enumeration oracle for anyone holding EXECUTE — call it in a loop and
--     the whole graph comes back. Reading the actor from the transaction means
--     an unnamed request gets nothing, exactly like every other rule here.
--   * `revoke ... from public` immediately after each one. Postgres grants
--     EXECUTE to PUBLIC by default, which would hand these to safehouse_auth —
--     the role 0003 stripped of every vault privilege on purpose.
--   * `set search_path = pg_catalog, pg_temp`, and every name in every body
--     fully qualified. A SQL function body is stored as text and re-resolved
--     on each call against the caller's search path; pg_temp is searched first
--     unless it is listed explicitly, so an unqualified `visible_record` can
--     be shadowed by a temporary table of the caller's own making. That would
--     turn this migration into a worse hole than the one it closes.
--
-- What this does NOT fix: `safehouse.user_id` is an ordinary setting, and any
-- role may set it. Anything able to run arbitrary SQL as safehouse_app can
-- still name a user id and read that user's vault. This closes the enumeration
-- — you must now already know an id, and `users_read` gives out only your own.
-- Making the actor unforgeable is a different and much larger change.

create schema perm;
--> statement-breakpoint

-- No USAGE granted, here or in scripts/db-setup.mjs. That absence is the first
-- lock, and permissions.test.ts asserts it for both restricted roles.
comment on schema perm is
  'The permission rules. Readable by the migrating role only; the application reaches them through the security definer functions below (D25).';
--> statement-breakpoint

-- ALTER, not drop and recreate. The policies keep working across the move
-- because their stored expressions refer to the views by oid, the view-on-view
-- chain does not have to be rebuilt in dependency order, and a recreated view
-- would come back carrying a fresh SELECT grant from the default privileges
-- below.
alter view app_user set schema perm;
--> statement-breakpoint
alter view effective_parent set schema perm;
--> statement-breakpoint
alter view current_spouse set schema perm;
--> statement-breakpoint
alter view active_emergency set schema perm;
--> statement-breakpoint
alter view family_circle set schema perm;
--> statement-breakpoint
alter view visible_owner set schema perm;
--> statement-breakpoint
alter view visible_record set schema perm;
--> statement-breakpoint
alter view visible_document set schema perm;
--> statement-breakpoint
alter view visible_file set schema perm;
--> statement-breakpoint

create function perm.visible_owner_ids() returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select v.owner_id
  from perm.visible_owner v
  where v.user_id = public.current_app_user()
$$;
--> statement-breakpoint
revoke all on function perm.visible_owner_ids() from public;
--> statement-breakpoint
grant execute on function perm.visible_owner_ids() to safehouse_app;
--> statement-breakpoint

create function perm.visible_record_ids() returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select v.record_id
  from perm.visible_record v
  where v.user_id = public.current_app_user()
$$;
--> statement-breakpoint
revoke all on function perm.visible_record_ids() from public;
--> statement-breakpoint
grant execute on function perm.visible_record_ids() to safehouse_app;
--> statement-breakpoint

create function perm.visible_document_ids() returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select v.document_id
  from perm.visible_document v
  where v.user_id = public.current_app_user()
$$;
--> statement-breakpoint
revoke all on function perm.visible_document_ids() from public;
--> statement-breakpoint
grant execute on function perm.visible_document_ids() to safehouse_app;
--> statement-breakpoint

create function perm.visible_file_ids() returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select v.file_id
  from perm.visible_file v
  where v.user_id = public.current_app_user()
$$;
--> statement-breakpoint
revoke all on function perm.visible_file_ids() from public;
--> statement-breakpoint
grant execute on function perm.visible_file_ids() to safehouse_app;
--> statement-breakpoint

-- The six `exists (select 1 from app_user ...)` clauses in 0001, said once.
create function perm.current_user_is_admin() returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from perm.app_user a
    where a.id = public.current_app_user() and a.role = 'admin'
  )
$$;
--> statement-breakpoint
revoke all on function perm.current_user_is_admin() from public;
--> statement-breakpoint
grant execute on function perm.current_user_is_admin() to safehouse_app;
--> statement-breakpoint

-- The rules are unchanged. Only the way a policy reaches them changes:
-- `= any (array(select ...))` rather than `in (select ... from a view)`. The
-- function is opaque to the planner, so it is evaluated once per query and the
-- result becomes an index condition instead of a filter on every row. The
-- other two spellings both work and are both far slower — a scalar
-- `can_see_record(id)` predicate runs per row and looks fine under a LIMIT.
drop policy owners_read on owners;
--> statement-breakpoint
create policy owners_read on owners for select to safehouse_app
using (id = any (array(select perm.visible_owner_ids())));
--> statement-breakpoint

drop policy people_read on people;
--> statement-breakpoint
create policy people_read on people for select to safehouse_app
using (owner_id = any (array(select perm.visible_owner_ids())));
--> statement-breakpoint

drop policy businesses_read on businesses;
--> statement-breakpoint
create policy businesses_read on businesses for select to safehouse_app
using (owner_id = any (array(select perm.visible_owner_ids())));
--> statement-breakpoint

-- An edge is visible when both of its ends are.
drop policy relationships_read on relationships;
--> statement-breakpoint
create policy relationships_read on relationships for select to safehouse_app
using (
  from_owner_id = any (array(select perm.visible_owner_ids()))
  and to_owner_id = any (array(select perm.visible_owner_ids()))
);
--> statement-breakpoint

drop policy records_read on records;
--> statement-breakpoint
create policy records_read on records for select to safehouse_app
using (id = any (array(select perm.visible_record_ids())));
--> statement-breakpoint

drop policy documents_read on documents;
--> statement-breakpoint
create policy documents_read on documents for select to safehouse_app
using (id = any (array(select perm.visible_document_ids())));
--> statement-breakpoint

drop policy document_files_read on document_files;
--> statement-breakpoint
create policy document_files_read on document_files for select to safehouse_app
using (id = any (array(select perm.visible_file_ids())));
--> statement-breakpoint

drop policy users_read on users;
--> statement-breakpoint
create policy users_read on users for select to safehouse_app
using (id = public.current_app_user() or perm.current_user_is_admin());
--> statement-breakpoint

drop policy grant_owners_read on grant_owners;
--> statement-breakpoint
create policy grant_owners_read on grant_owners for select to safehouse_app
using (user_id = public.current_app_user() or perm.current_user_is_admin());
--> statement-breakpoint

drop policy grant_categories_read on grant_categories;
--> statement-breakpoint
create policy grant_categories_read on grant_categories for select to safehouse_app
using (user_id = public.current_app_user() or perm.current_user_is_admin());
--> statement-breakpoint

drop policy grant_records_read on grant_records;
--> statement-breakpoint
create policy grant_records_read on grant_records for select to safehouse_app
using (user_id = public.current_app_user() or perm.current_user_is_admin());
--> statement-breakpoint

drop policy emergency_activations_read on emergency_activations;
--> statement-breakpoint
create policy emergency_activations_read on emergency_activations for select to safehouse_app
using (user_id = public.current_app_user() or perm.current_user_is_admin());
--> statement-breakpoint

drop policy activity_events_read on activity_events;
--> statement-breakpoint
create policy activity_events_read on activity_events for select to safehouse_app
using (perm.current_user_is_admin());
--> statement-breakpoint

-- The second lock. Nothing names these views in a policy any more, so the
-- grant 0001 had to make can go.
revoke all on all tables in schema perm from safehouse_app;
--> statement-breakpoint
revoke all on all tables in schema perm from safehouse_auth;
--> statement-breakpoint

-- 0001 wrote this with no `in schema` clause, which makes it apply to every
-- schema there will ever be — a tenth permission view added to `perm` next
-- year would be born readable by the application. The revoke has to mirror the
-- original grant character for character: a scope that does not match is
-- accepted, reports success, and changes nothing.
alter default privileges for role safehouse revoke select on tables from safehouse_app;
--> statement-breakpoint
alter default privileges for role safehouse in schema public grant select on tables to safehouse_app;
--> statement-breakpoint

-- The third belt against a temporary table shadowing a name inside a function
-- body. The application has never made one and does not need to.
do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
end
$$;
--> statement-breakpoint

-- Everything above is silent when it half-works: a policy that still names a
-- view, a revoke that missed, a default privilege left global. Drizzle runs the
-- whole migration in one transaction, so a failure here takes all of it back.
do $$
declare
  offender text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname)
  into offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and has_table_privilege('safehouse_app', c.oid, 'select');

  if offender is not null then
    raise exception 'safehouse_app can still read: %', offender;
  end if;

  if has_schema_privilege('safehouse_app', 'perm', 'usage')
     or has_schema_privilege('safehouse_auth', 'perm', 'usage') then
    raise exception 'a restricted role has usage on schema perm';
  end if;

  if exists (select 1 from pg_default_acl where defaclnamespace = 0) then
    raise exception 'a default privilege still applies to every schema';
  end if;

  select string_agg(p.proname, ', ' order by p.proname)
  into offender
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname = 'perm'
    and (
      p.pronargs <> 0
      or p.proconfig is distinct from array['search_path=pg_catalog, pg_temp']
      or has_function_privilege('public', p.oid, 'execute')
      or has_function_privilege('safehouse_auth', p.oid, 'execute')
    );

  if offender is not null then
    raise exception 'unsafe security definer function: %', offender;
  end if;
end
$$;
