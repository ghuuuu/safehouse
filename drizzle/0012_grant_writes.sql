-- Granting access, and taking it away (Step 12, D21, D34).
--
-- The three grant tables have been readable since 0001 and writable by nobody;
-- the fixture was the only thing that ever put a row in them. The access
-- console is the surface D21 makes "the only place grants are edited", and this
-- is what it writes through.
--
-- **Admin only, on the predicate's own text.** `grant_records` is the one route
-- into a private record (D17), so a member able to insert a row here could open
-- anybody's therapy letter for themselves. No other rule stands between them:
-- unlike `people_write` there is no second-order visibility check that would
-- happen to refuse them. The admin predicate is the whole of it, and the block
-- at the bottom pins it to the policy text.
--
-- **Insert and delete, never update.** A grant is a fact that exists or does
-- not. An update would be a delete and an insert logged as neither.
--
-- **Both ends must be visible to the actor**, the same as every write policy
-- here: nothing is written into the dark (0005). For an admin that is every
-- owner and every record, so today this is a belt; it becomes the rule the day
-- an admin can be narrowed (D34).
--
-- The log learns to say what was granted. `subject` is the account whose access
-- changed; the two new columns name what changed, typed so they can only ever
-- hold an id or a category — never a title, never a number somebody typed.

grant insert, delete on grant_owners, grant_categories, grant_records to safehouse_app;
--> statement-breakpoint

create policy grant_owners_write on grant_owners for insert to safehouse_app
with check (
  perm.current_user_is_admin()
  and owner_id = any (array(select perm.visible_owner_ids()))
);
--> statement-breakpoint
create policy grant_owners_remove on grant_owners for delete to safehouse_app
using (perm.current_user_is_admin());
--> statement-breakpoint

create policy grant_categories_write on grant_categories for insert to safehouse_app
with check (perm.current_user_is_admin());
--> statement-breakpoint
create policy grant_categories_remove on grant_categories for delete to safehouse_app
using (perm.current_user_is_admin());
--> statement-breakpoint

create policy grant_records_write on grant_records for insert to safehouse_app
with check (
  perm.current_user_is_admin()
  and record_id = any (array(select perm.visible_record_ids()))
);
--> statement-breakpoint
create policy grant_records_remove on grant_records for delete to safehouse_app
using (perm.current_user_is_admin());
--> statement-breakpoint

alter table activity_events add column target_id uuid;
--> statement-breakpoint
alter table activity_events add column target_category category;
--> statement-breakpoint

do $$
declare
  offender text;
begin
  -- The whole write surface, restated (0009 explains why it is restated each
  -- time rather than added to).
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
        'grant_owners', 'grant_categories', 'grant_records'
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

  -- Six policies, each with the expression its command needs. An insert policy
  -- without `with check`, or a delete policy without `using`, allows everything
  -- the grant allows.
  select string_agg(polname, ', ' order by polname)
  into offender
  from pg_policy
  where polname like 'grant\_%\_write' escape '\' and (polcmd <> 'a' or polwithcheck is null)
     or polname like 'grant\_%\_remove' escape '\' and (polcmd <> 'd' or polqual is null);

  if offender is not null then
    raise exception 'grant policy without its expression: %', offender;
  end if;

  if (
    select count(*) from pg_policy
    where polname like 'grant\_%\_write' escape '\' or polname like 'grant\_%\_remove' escape '\'
  ) <> 6 then
    raise exception 'expected six grant write policies';
  end if;

  select string_agg(polname, ', ' order by polname)
  into offender
  from pg_policy
  where (polname like 'grant\_%\_write' escape '\' or polname like 'grant\_%\_remove' escape '\')
    and coalesce(pg_get_expr(polwithcheck, polrelid), pg_get_expr(polqual, polrelid))
        not like '%current_user_is_admin%';

  if offender is not null then
    raise exception 'a grant policy no longer requires an admin: %', offender;
  end if;
end
$$;
