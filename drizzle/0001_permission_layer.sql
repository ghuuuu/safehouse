-- The permission layer (D11).
--
-- Read this file top to bottom and you have read every access rule in
-- Safehouse. There is no second copy of these rules in the application, and
-- nothing above this layer can widen them.
--
-- How it holds together:
--
--   * The application connects as `safehouse_app`, which owns nothing. Every
--     policy below applies to it. See scripts/db-setup.mjs.
--   * Each request says who is asking by setting `safehouse.user_id` for the
--     duration of one transaction. If it forgets, `current_app_user()` is null,
--     no policy matches, and every query returns nothing.
--   * The views are owned by the migrating role, so they read the base tables
--     without tripping over the policies that are defined in terms of them.
--
-- Only SELECT is granted. Writing is not implemented yet, and a table with no
-- write policy rejects writes — which is the right way round to be wrong.

create function current_app_user() returns uuid
language sql
stable
as $$
  select nullif(current_setting('safehouse.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Signed-in accounts, minus the disabled ones. Disabling an account is meant to
-- take effect everywhere at once, so it is subtracted here rather than in each
-- rule that might otherwise forget.
create view app_user as
select id, role, person_owner_id
from users
where disabled_at is null;
--> statement-breakpoint

-- Parent edges that confer access. Biological and adoptive always do; a
-- guardianship does while it lasts; a step edge never does (D16).
create view effective_parent as
select from_owner_id as parent_owner_id, to_owner_id as child_owner_id
from relationships
where kind = 'parent_of'
  and (
    parent_type in ('biological', 'adoptive')
    or (parent_type = 'guardian' and ended_on is null)
  );
--> statement-breakpoint

-- Marriages that have not ended, read from both directions. A widowed spouse is
-- still a spouse: death does not set `ended_on`, divorce does.
create view current_spouse as
select from_owner_id as person_owner_id, to_owner_id as spouse_owner_id
from relationships
where kind = 'spouse_of' and ended_on is null
union
select to_owner_id, from_owner_id
from relationships
where kind = 'spouse_of' and ended_on is null;
--> statement-breakpoint

-- Break-glass windows that are open right now, by the database clock. Nothing
-- closes these on a schedule, so no job failing to run can leave one open (D19).
create view active_emergency as
select user_id
from emergency_activations
where revoked_at is null and expires_at > now();
--> statement-breakpoint

-- You, your spouse, your children, your parents, and your spouse's parents.
-- Grandparents are two steps away and deliberately outside it.
create view family_circle as
select a.id as user_id, a.person_owner_id as owner_id
from app_user a
where a.person_owner_id is not null
union
select a.id, s.spouse_owner_id
from app_user a
join current_spouse s on s.person_owner_id = a.person_owner_id
union
select a.id, p.child_owner_id
from app_user a
join effective_parent p on p.parent_owner_id = a.person_owner_id
union
select a.id, p.parent_owner_id
from app_user a
join effective_parent p on p.child_owner_id = a.person_owner_id
union
select a.id, p.parent_owner_id
from app_user a
join current_spouse s on s.person_owner_id = a.person_owner_id
join effective_parent p on p.child_owner_id = s.spouse_owner_id;
--> statement-breakpoint

-- Whose papers a user can reach at all (D16). Which of those papers they can
-- then see is the next view down.
create view visible_owner as
-- The admin runs the household and sees every owner.
select a.id as user_id, o.id as owner_id
from app_user a
cross join owners o
where a.role = 'admin'
union
-- Family, by the tree.
select fc.user_id, fc.owner_id
from family_circle fc
union
-- The household's own papers — the deed, the marriage certificate, the home
-- insurance — belong to everyone living in it.
select a.id, o.id
from app_user a
cross join owners o
where a.role = 'individual' and o.kind = 'household'
union
-- Anything granted by name. This is how a step-parent, an accountant, or the
-- family member who runs the business gets in: deliberately, one at a time.
select g.user_id, g.owner_id
from grant_owners g
join app_user a on a.id = g.user_id
union
-- An open emergency window reaches every owner. It is narrowed to the critical
-- categories one view down, not here (D19).
select a.id, o.id
from app_user a
join active_emergency e on e.user_id = a.id
cross join owners o
where a.role = 'emergency';
--> statement-breakpoint

-- The rule the whole product turns on.
create view visible_record as
-- The admin sees everything, private included. Privacy is from family, not from
-- whoever runs the server, and the interface has to say so (D17).
select a.id as user_id, r.id as record_id
from app_user a
cross join records r
where a.role = 'admin'
union
-- Family and household members see the records of the owners they can reach,
-- except the private ones, which stop at their owner.
select vo.user_id, r.id
from visible_owner vo
join app_user a on a.id = vo.user_id and a.role = 'individual'
join records r on r.owner_id = vo.owner_id
where not r.is_private or r.owner_id = a.person_owner_id
union
-- A third party needs both lists to agree: this owner, and this category. Two
-- lists rather than one grid, so widening one never quietly widens the other
-- (D18). Private records are never included.
select a.id, r.id
from app_user a
join grant_owners go on go.user_id = a.id
join grant_categories gc on gc.user_id = a.id
join records r on r.owner_id = go.owner_id and r.category = gc.category
where a.role = 'third_party' and not r.is_private
union
-- Break-glass: the critical categories, for as long as the window is open. A
-- private advance directive hidden during a medical emergency would defeat the
-- reason the feature exists, so private is reachable here on purpose (D17).
select a.id, r.id
from app_user a
join active_emergency e on e.user_id = a.id
cross join records r
where a.role = 'emergency' and r.category in ('medical', 'legal')
union
-- The per-record grant. The only route into a private record, and it overrides
-- both lists above (D17).
select gr.user_id, gr.record_id
from grant_records gr
join app_user a on a.id = gr.user_id;
--> statement-breakpoint

create view visible_document as
select vr.user_id, d.id as document_id
from visible_record vr
join documents d on d.record_id = vr.record_id;
--> statement-breakpoint

create view visible_file as
select vd.user_id, f.id as file_id
from visible_document vd
join document_files f on f.document_id = vd.document_id;
--> statement-breakpoint

alter table owners enable row level security;
--> statement-breakpoint
create policy owners_read on owners for select to safehouse_app
using (
  id in (select owner_id from visible_owner where user_id = current_app_user())
);
--> statement-breakpoint

alter table people enable row level security;
--> statement-breakpoint
create policy people_read on people for select to safehouse_app
using (
  owner_id in (select owner_id from visible_owner where user_id = current_app_user())
);
--> statement-breakpoint

alter table businesses enable row level security;
--> statement-breakpoint
create policy businesses_read on businesses for select to safehouse_app
using (
  owner_id in (select owner_id from visible_owner where user_id = current_app_user())
);
--> statement-breakpoint

-- An edge is visible when both of its ends are. A divorce therefore hides the
-- edge that records it, rather than leaving a dangling name in the tree.
alter table relationships enable row level security;
--> statement-breakpoint
create policy relationships_read on relationships for select to safehouse_app
using (
  from_owner_id in (select owner_id from visible_owner where user_id = current_app_user())
  and to_owner_id in (select owner_id from visible_owner where user_id = current_app_user())
);
--> statement-breakpoint

alter table records enable row level security;
--> statement-breakpoint
create policy records_read on records for select to safehouse_app
using (
  id in (select record_id from visible_record where user_id = current_app_user())
);
--> statement-breakpoint

alter table documents enable row level security;
--> statement-breakpoint
create policy documents_read on documents for select to safehouse_app
using (
  id in (select document_id from visible_document where user_id = current_app_user())
);
--> statement-breakpoint

alter table document_files enable row level security;
--> statement-breakpoint
create policy document_files_read on document_files for select to safehouse_app
using (
  id in (select file_id from visible_file where user_id = current_app_user())
);
--> statement-breakpoint

-- A user can see their own account; the admin can see all of them.
alter table users enable row level security;
--> statement-breakpoint
create policy users_read on users for select to safehouse_app
using (
  id = current_app_user()
  or exists (
    select 1 from app_user a where a.id = current_app_user() and a.role = 'admin'
  )
);
--> statement-breakpoint

alter table grant_owners enable row level security;
--> statement-breakpoint
create policy grant_owners_read on grant_owners for select to safehouse_app
using (
  user_id = current_app_user()
  or exists (
    select 1 from app_user a where a.id = current_app_user() and a.role = 'admin'
  )
);
--> statement-breakpoint

alter table grant_categories enable row level security;
--> statement-breakpoint
create policy grant_categories_read on grant_categories for select to safehouse_app
using (
  user_id = current_app_user()
  or exists (
    select 1 from app_user a where a.id = current_app_user() and a.role = 'admin'
  )
);
--> statement-breakpoint

alter table grant_records enable row level security;
--> statement-breakpoint
create policy grant_records_read on grant_records for select to safehouse_app
using (
  user_id = current_app_user()
  or exists (
    select 1 from app_user a where a.id = current_app_user() and a.role = 'admin'
  )
);
--> statement-breakpoint

alter table emergency_activations enable row level security;
--> statement-breakpoint
create policy emergency_activations_read on emergency_activations for select to safehouse_app
using (
  user_id = current_app_user()
  or exists (
    select 1 from app_user a where a.id = current_app_user() and a.role = 'admin'
  )
);
--> statement-breakpoint

alter table notifications enable row level security;
--> statement-breakpoint
create policy notifications_read on notifications for select to safehouse_app
using (user_id = current_app_user());
--> statement-breakpoint

-- The log of who looked at what. Only the admin reads it, and nobody edits it.
alter table activity_events enable row level security;
--> statement-breakpoint
create policy activity_events_read on activity_events for select to safehouse_app
using (
  exists (
    select 1 from app_user a where a.id = current_app_user() and a.role = 'admin'
  )
);
--> statement-breakpoint

-- No personal data in these two, but a request that has not said who is asking
-- gets nothing at all, so that the empty-page failure is the same everywhere.
alter table subcategories enable row level security;
--> statement-breakpoint
create policy subcategories_read on subcategories for select to safehouse_app
using (current_app_user() is not null);
--> statement-breakpoint

alter table settings enable row level security;
--> statement-breakpoint
create policy settings_read on settings for select to safehouse_app
using (current_app_user() is not null);
--> statement-breakpoint

grant select on all tables in schema public to safehouse_app;
--> statement-breakpoint

-- Tables added by a later migration are readable but, having no policy, return
-- nothing until one is written. A test asserts that every table has row-level
-- security switched on.
alter default privileges for role safehouse grant select on tables to safehouse_app;
