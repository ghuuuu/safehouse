-- Which version a conversion started from (D42).
--
-- A draft that converts or renews a record becomes that record's next version
-- when it is filed. If somebody else filed a version in the meantime (two
-- members converting the same old image, each unable to see the other's
-- draft), filing would quietly supersede work its filer never saw. The draft
-- remembers the version that was current when it was opened; filing compares,
-- and a difference stops it and asks.
--
-- Set when the draft is made and never changed: it is not in the update
-- grant. Saying "file mine over the newer one" is passed to the filing itself,
-- naming the version being superseded, so nothing here needs to move.
--
-- It must be a version the person can see, or the insert would be a way to
-- ask whether a document id exists.

alter table intakes add column base_document_id uuid references documents(id);
--> statement-breakpoint

drop policy intakes_start on intakes;
--> statement-breakpoint
create policy intakes_start on intakes for insert to safehouse_app
with check (
  created_by = public.current_app_user()
  and perm.current_user_may_file()
  and (owner_id is null or owner_id = any (array(select perm.visible_owner_ids())))
  and (record_id is null or record_id = any (array(select perm.visible_record_ids())))
  and (base_document_id is null or base_document_id = any (array(select perm.visible_document_ids())))
);
--> statement-breakpoint

do $$
begin
  if has_column_privilege('safehouse_app', 'public.intakes', 'base_document_id', 'UPDATE') then
    raise exception 'the version a draft started from could be changed after the fact';
  end if;

  if has_column_privilege('safehouse_app', 'public.intakes', 'created_by', 'UPDATE') then
    raise exception 'an intake could be handed to somebody else';
  end if;

  if (select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'intakes_start')
     not like '%visible_document_ids%' then
    raise exception 'intakes_start no longer checks the version a draft started from';
  end if;
end
$$;
