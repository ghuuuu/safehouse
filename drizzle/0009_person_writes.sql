-- Adding somebody to the household.
--
-- Until now the tree could only be created by the fixture. A deployment that
-- cannot add a person is a household of one, which is every deployment this has
-- ever made outside the test database.
--
-- **Admin only, and that is the interesting decision.** Filing a document is
-- allowed to anybody who may file (0005), because who may *see* a document is
-- the rule this product guards and adding one to a drawer changes nothing about
-- that. A tree edge is the opposite: `family_circle` reads these rows directly,
-- so one spouse edge hands an account somebody else's entire vault. That makes
-- adding a relationship an access-control change wearing the clothes of a data
-- entry form, and access-control changes belong to the administrator.
--
-- A corollary worth stating: a person row is not a login. Creating one grants
-- nobody anything. Attaching an account to it is a separate act on a separate
-- connection (D24), and that is where the escalation risk actually lives.
--
-- Person owners only. A business belongs to the mode switcher and its own
-- screen; the household's own owner row is created once, at first run, and
-- allowing it here would mean allowing a second one.
--
-- Insert only, again. `owners.archived_at` exists precisely so that a person who
-- leaves the household is archived rather than deleted — a deleted owner would
-- take their documents' filing with them, and this vault has no way to destroy a
-- document on purpose, let alone by cascade.

grant insert on owners, people, relationships to safehouse_app;
--> statement-breakpoint

-- One person, one login. Not a convenience: the roster joins `users` to `owners`
-- to say whether somebody can sign in, and a second account on the same person
-- would quietly double that row. It would also break view-as and the activity
-- log, both of which name a person by the account that acted. Partial, so the
-- many accounts attached to nobody — third parties, emergency contacts, an
-- account made a minute ago — are unaffected.
create unique index users_one_account_per_person
  on users (person_owner_id)
  where person_owner_id is not null;
--> statement-breakpoint

create policy owners_write on owners for insert to safehouse_app
with check (perm.current_user_is_admin() and kind = 'person');
--> statement-breakpoint

-- `owner_id` must name an owner the actor can see, exactly like every other
-- write check here. For an admin that is every owner, including the one inserted
-- a statement earlier in the same transaction — which is what makes
-- owner-then-person work without a second round of permission reasoning.
create policy people_write on people for insert to safehouse_app
with check (
  perm.current_user_is_admin()
  and owner_id = any (array(select perm.visible_owner_ids()))
);
--> statement-breakpoint

-- Both ends, mirroring `relationships_read`: an edge is writable when it is
-- readable, so nothing can be written into the dark (0005).
create policy relationships_write on relationships for insert to safehouse_app
with check (
  perm.current_user_is_admin()
  and from_owner_id = any (array(select perm.visible_owner_ids()))
  and to_owner_id = any (array(select perm.visible_owner_ids()))
);
--> statement-breakpoint

do $$
declare
  offender text;
begin
  -- The whole write surface, restated. Four migrations have each added to it and
  -- none of them can see the others, so the only way to know what the
  -- application may write is to list it here and fail if it has grown.
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
        'owners', 'people', 'relationships'
      )
    )
    and not (p.privilege_type = 'UPDATE' and c.relname = 'documents');

  if offender is not null then
    raise exception 'safehouse_app can write more than it should: %', offender;
  end if;

  -- Three INSERT policies, each with a check expression. A policy created
  -- without `with check` permits every insert the grant allows, silently.
  select string_agg(polname, ', ' order by polname)
  into offender
  from pg_policy
  where polname in ('owners_write', 'people_write', 'relationships_write')
    and (polcmd <> 'a' or polwithcheck is null);

  if offender is not null then
    raise exception 'write policy without an INSERT check: %', offender;
  end if;

  if (
    select count(*) from pg_policy
    where polname in ('owners_write', 'people_write', 'relationships_write')
  ) <> 3 then
    raise exception 'expected three new write policies';
  end if;

  -- Each one actually names the admin predicate.
  --
  -- This is asserted here because no test can catch it. Widen these to
  -- `current_user_may_file()` and the behaviour does not change: an ordinary
  -- member is still refused, because `visible_owner` does not hand an
  -- individual an owner row created a moment ago and `people_write` requires
  -- it. The rule would then rest entirely on that second-order fact, and would
  -- come undone the day somebody widened `visible_owner` for an unrelated
  -- reason, with every test still green. So the intent is pinned to the text.
  select string_agg(polname, ', ' order by polname)
  into offender
  from pg_policy
  where polname in ('owners_write', 'people_write', 'relationships_write')
    and pg_get_expr(polwithcheck, polrelid) not like '%current_user_is_admin%';

  if offender is not null then
    raise exception 'a tree write policy no longer requires an admin: %', offender;
  end if;
end
$$;
