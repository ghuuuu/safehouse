-- The first writes this database has ever allowed the application to make.
--
-- Everything before this is a `using` clause over reads. A `with check` asks a
-- different question, and the difference is the whole risk: "may see this
-- record" is not "may add a document to it", and a check copied from a using
-- clause is how a document ends up filed under somebody who never agreed to
-- hold it.
--
-- Three decisions, all narrow on purpose, because widening a permission later
-- is a line of SQL and narrowing one after a household has used it is not.
--
--   Who may file at all. Admins and individuals. A third party reaches the
--   business papers they were granted (D18) and an emergency contact reaches
--   critical categories while their window is open (D19) — both are reads.
--   Being allowed to look in the drawer is not permission to put things in it,
--   and a break-glass window that could write is a window that can plant a
--   document.
--
--   Whose drawer. Any owner the filer can already see. A household filing
--   cabinet only one person may add to is a filing cabinet nobody uses, and
--   who may *see* a document is the rule this product actually guards.
--
--   Nothing that writes into the dark. A `with check` wider than its `using`
--   clause writes rows its author cannot read back, which looks exactly like
--   data loss. The only way to produce one here is a private record for
--   somebody else's owner, so that is the one case excluded.
--
-- Insert only. No update, no delete, no grant for either: superseding a
-- document and editing a record are the Record screen's business and will
-- arrive with their own policies and their own tests. Until then the role has
-- no privilege at all, which fails louder than a policy would.

-- Two locks, as everywhere else here: the grant, and the policy. Either alone
-- would be enough; neither alone is what this project does.
grant insert on records, documents, document_files to safehouse_app;
--> statement-breakpoint

-- Zero-argument, security definer, reading a view the application cannot (D25).
-- A parameter here would make it an oracle: `may_file(some_other_user)` answers
-- questions about accounts the caller cannot see.
create function perm.current_user_may_file() returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from perm.app_user a
    where a.id = public.current_app_user()
      and a.role in ('admin', 'individual')
  )
$$;
--> statement-breakpoint

revoke all on function perm.current_user_may_file() from public;
--> statement-breakpoint
grant execute on function perm.current_user_may_file() to safehouse_app;
--> statement-breakpoint

-- Which person the signed-in account *is*, for the one rule that needs it:
-- marking a record private is only allowed for your own papers. Null for an
-- account with nobody attached to it, which fails the comparison and so fails
-- closed.
create function perm.current_user_person_owner() returns uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select a.person_owner_id
  from perm.app_user a
  where a.id = public.current_app_user()
$$;
--> statement-breakpoint

revoke all on function perm.current_user_person_owner() from public;
--> statement-breakpoint
grant execute on function perm.current_user_person_owner() to safehouse_app;
--> statement-breakpoint

-- `= any (array(select ...))` for the same reason 0004 gives: the function is
-- opaque to the planner and gets evaluated once rather than per row.
create policy records_write on records for insert to safehouse_app
with check (
  perm.current_user_may_file()
  and owner_id = any (array(select perm.visible_owner_ids()))
  and (
    not is_private
    or perm.current_user_is_admin()
    or owner_id = perm.current_user_person_owner()
  )
);
--> statement-breakpoint

create policy documents_write on documents for insert to safehouse_app
with check (
  perm.current_user_may_file()
  and record_id = any (array(select perm.visible_record_ids()))
);
--> statement-breakpoint

create policy document_files_write on document_files for insert to safehouse_app
with check (
  perm.current_user_may_file()
  and document_id = any (array(select perm.visible_document_ids()))
);
--> statement-breakpoint

-- Half of this is silent when it half-works. A grant that landed on a fourth
-- table, an update privilege nobody asked for, a policy that exists but for the
-- wrong command — none of them raise anything by themselves. Drizzle runs a
-- migration in one transaction, so a failure here takes all of it back.
do $$
declare
  offender text;
begin
  -- Nothing beyond the three tables may be written, and none of the three may
  -- be updated or deleted from.
  select string_agg(format('%s:%s', c.relname, p.privilege_type), ', ' order by c.relname)
  into offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (
    values ('INSERT'), ('UPDATE'), ('DELETE')
  ) as p(privilege_type)
  where n.nspname = 'public'
    and c.relkind = 'r'
    and has_table_privilege('safehouse_app', c.oid, p.privilege_type)
    and not (
      p.privilege_type = 'INSERT'
      and c.relname in ('records', 'documents', 'document_files')
    );

  if offender is not null then
    raise exception 'safehouse_app can write more than it should: %', offender;
  end if;

  -- The three policies exist, are INSERT policies, and have a check expression.
  -- A policy created without `with check` permits every insert the grant allows.
  select string_agg(polname, ', ' order by polname)
  into offender
  from pg_policy
  where polname in ('records_write', 'documents_write', 'document_files_write')
    and (polcmd <> 'a' or polwithcheck is null);

  if offender is not null then
    raise exception 'write policy without an INSERT check: %', offender;
  end if;

  if (
    select count(*) from pg_policy
    where polname in ('records_write', 'documents_write', 'document_files_write')
  ) <> 3 then
    raise exception 'expected three write policies';
  end if;

  -- The new functions must not be callable by anybody who wanders in.
  if has_function_privilege('public', 'perm.current_user_may_file()', 'execute')
    or has_function_privilege('public', 'perm.current_user_person_owner()', 'execute')
  then
    raise exception 'the new permission functions are executable by public';
  end if;
end
$$;
