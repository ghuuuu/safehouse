-- Imports that are not finished yet (D40).
--
-- An upload becomes an intake, not a document. It is reviewed there (pages
-- straightened, sized, ordered, read, the fields corrected) and only filed
-- into records, documents and document_files when somebody submits it. Three
-- tables, apart from the vault's own, so that no vault list, search, count or
-- download can reach a draft by forgetting a filter:
--
--   intakes         the draft: whose, what, the fields as they stand
--   intake_sources  each upload, sealed exactly as a document file is (D12)
--   intake_pages    the pages, in order, each pointing into a source
--
-- Who reaches one: its uploader and the household's admins. Not another
-- member, not a third party, not an emergency contact. The admin is there so
-- an upload left half done is never stuck where nobody can finish it.
--
-- Who makes one: whoever may file (admins and individuals, 0005), in their own
-- name only, for an owner they can already see. `created_by` is not in the
-- update grant, so a draft can never be handed to somebody else's name.
--
-- These are the first tables the application may delete from in full. That is
-- the point of a draft; nothing in the vault gains a delete.

create table intakes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users(id),
  owner_id uuid references owners(id),
  category category,
  title text,
  -- Set when the intake converts or renews a record already in the vault.
  record_id uuid references records(id),
  -- Proposals and edits, as `{ field: { value, source, confirmed } }`. The
  -- identifier is never in here: it is sealed below, as D35 seals it.
  fields jsonb not null default '{}'::jsonb,
  identifier_sealed bytea,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
--> statement-breakpoint
create index intakes_created_by on intakes (created_by);
--> statement-breakpoint

create table intake_sources (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references intakes(id) on delete cascade,
  storage_key text not null unique,
  sha256 text not null,
  byte_size integer not null,
  mime text not null,
  wrapped_dek bytea not null,
  nonce bytea not null,
  created_at timestamp with time zone not null default now()
);
--> statement-breakpoint

create table intake_pages (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references intakes(id) on delete cascade,
  source_id uuid not null references intake_sources(id) on delete cascade,
  -- Which page of a source PDF; 0 for a photo.
  source_page integer not null default 0,
  position integer not null,
  -- A photo's four corners in its own pixels, `[[x,y] x4]`, clockwise from
  -- top left. Null for a page copied from a PDF.
  corners jsonb,
  -- A preset key ('id1', 'id3', 'a4', ...), or `{ "w": mm, "h": mm }`.
  size jsonb,
  rotation integer not null default 0 check (rotation in (0, 90, 180, 270))
);
--> statement-breakpoint

alter table intakes enable row level security;
--> statement-breakpoint
alter table intake_sources enable row level security;
--> statement-breakpoint
alter table intake_pages enable row level security;
--> statement-breakpoint

grant select, insert, delete on intakes, intake_sources, intake_pages to safehouse_app;
--> statement-breakpoint
grant update (owner_id, category, title, record_id, fields, identifier_sealed, updated_at)
  on intakes to safehouse_app;
--> statement-breakpoint
grant update (position, corners, size, rotation) on intake_pages to safehouse_app;
--> statement-breakpoint

-- Reads, edits and discards: the uploader's own, or any for an admin.
create policy intakes_reach on intakes for select to safehouse_app
using (created_by = public.current_app_user() or perm.current_user_is_admin());
--> statement-breakpoint
create policy intakes_discard on intakes for delete to safehouse_app
using (created_by = public.current_app_user() or perm.current_user_is_admin());
--> statement-breakpoint

-- A new draft: one's own, by someone who may file, for an owner and a record
-- already in reach. The same reach is re-checked on every edit.
create policy intakes_start on intakes for insert to safehouse_app
with check (
  created_by = public.current_app_user()
  and perm.current_user_may_file()
  and (owner_id is null or owner_id = any (array(select perm.visible_owner_ids())))
  and (record_id is null or record_id = any (array(select perm.visible_record_ids())))
);
--> statement-breakpoint
create policy intakes_edit on intakes for update to safehouse_app
using (created_by = public.current_app_user() or perm.current_user_is_admin())
with check (
  perm.current_user_may_file()
  and (owner_id is null or owner_id = any (array(select perm.visible_owner_ids())))
  and (record_id is null or record_id = any (array(select perm.visible_record_ids())))
);
--> statement-breakpoint

-- Sources and pages belong to an intake the caller reaches. The subquery reads
-- `intakes` under its own policy, so reach is decided in one place.
create policy intake_sources_reach on intake_sources for all to safehouse_app
using (intake_id = any (array(select i.id from public.intakes i)))
with check (
  perm.current_user_may_file()
  and intake_id = any (array(select i.id from public.intakes i))
);
--> statement-breakpoint
create policy intake_pages_reach on intake_pages for all to safehouse_app
using (intake_id = any (array(select i.id from public.intakes i)))
with check (
  perm.current_user_may_file()
  and intake_id = any (array(select i.id from public.intakes i))
);
--> statement-breakpoint

do $$
declare
  offender text;
begin
  -- The whole write surface, restated (0009 explains why). New here: the three
  -- intake tables, and only them, may be inserted into, updated and deleted
  -- from. No vault table gains anything.
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
    )
    and not c.relname in ('intakes', 'intake_sources', 'intake_pages');

  if offender is not null then
    raise exception 'safehouse_app can write more than it should: %', offender;
  end if;

  -- `created_by` is never writable after the fact.
  if has_column_privilege('safehouse_app', 'public.intakes', 'created_by', 'UPDATE') then
    raise exception 'an intake could be handed to somebody else';
  end if;

  -- Every intake policy names the uploader or the subquery over intakes.
  select string_agg(polname, ', ' order by polname)
  into offender
  from pg_policy
  where polname in ('intakes_reach', 'intakes_discard', 'intakes_edit')
    and pg_get_expr(polqual, polrelid) not like '%current_app_user%';

  if offender is not null then
    raise exception 'intake policy without the uploader test: %', offender;
  end if;

  if (select count(*) from pg_policy where polname in (
        'intakes_reach', 'intakes_discard', 'intakes_start', 'intakes_edit',
        'intake_sources_reach', 'intake_pages_reach')) <> 6 then
    raise exception 'expected six intake policies';
  end if;
end
$$;
