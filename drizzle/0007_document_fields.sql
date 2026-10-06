-- The fields become editable, and a value learns whether anybody believes it.
--
-- `documents` has carried issued_on, expires_on, issuer_country, identifier and
-- place_of_issue since 0000, and nothing has ever written one of them through
-- the application. This is the Record screen's half of the database.
--
-- `confirmed_fields` is the new idea, and it is D26's requirement rather than a
-- convenience: extraction proposes values and a person confirms them, so the
-- difference between "a human typed this" and "a scanner guessed this" has to
-- be representable before anything starts guessing. A value nobody has
-- confirmed is not allowed to drive a reminder. Typing a value by hand confirms
-- it in the same breath; a reader filling it in does not.
--
-- UPDATE on documents only. Not on records — retitling, recategorising and
-- flipping privacy change who can see a thing and belong with the screen that
-- owns that question. Not DELETE on anything: this vault has no way to destroy
-- a document yet and will not grow one by accident.

grant update on documents to safehouse_app;
--> statement-breakpoint

alter table documents
  add column confirmed_fields jsonb not null default '[]'::jsonb;
--> statement-breakpoint

-- Both halves matter. `using` says which rows may be reached at all; `with
-- check` says what they may be turned into. Without the second, a row could be
-- updated to point at a record the editor cannot see, which moves a document
-- out of its owner's vault and into somebody else's.
create policy documents_update on documents for update to safehouse_app
using (
  perm.current_user_may_file()
  and id = any (array(select perm.visible_document_ids()))
)
with check (
  perm.current_user_may_file()
  and record_id = any (array(select perm.visible_record_ids()))
);
--> statement-breakpoint

do $$
declare
  offender text;
begin
  if not has_table_privilege('safehouse_app', 'documents', 'UPDATE') then
    raise exception 'the application still cannot edit a document';
  end if;

  -- Nothing gained a delete privilege, and records stayed insert-only.
  select string_agg(format('%s:%s', c.relname, p.privilege_type), ', ')
  into offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (values ('UPDATE'), ('DELETE')) as p(privilege_type)
  where n.nspname = 'public'
    and c.relkind = 'r'
    and has_table_privilege('safehouse_app', c.oid, p.privilege_type)
    and not (p.privilege_type = 'UPDATE' and c.relname = 'documents');

  if offender is not null then
    raise exception 'unexpected write privilege: %', offender;
  end if;

  if (
    select count(*) from pg_policy
    where polname = 'documents_update'
      and polcmd = 'w'
      and polqual is not null
      and polwithcheck is not null
  ) <> 1 then
    raise exception 'documents_update is missing, or has no using/check pair';
  end if;
end
$$;
