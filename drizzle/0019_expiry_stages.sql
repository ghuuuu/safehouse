-- Expiry reminders in stages (D37, amended 2026-10-21).
--
-- 0015 allowed one `expiry.soon` row per admin per document, ever: a paper was
-- mentioned once, when it entered the household's window, and never again. A
-- row now says which stage it is for, and the index allows one of each:
--
--   early  it entered the window (the setting, sixty days unless changed)
--   week   seven days or fewer
--   three  three days or fewer
--   today  the day itself, or already gone
--
-- The sweep writes the stage a paper is in now and never the ones it missed,
-- so a paper first seen two days out is told of once, not three times.
--
-- Rows written before this get the stage their paper is in today, so the
-- upgrade does not send a second message about every paper already warned of.
--
-- The stage is not updatable, like `kind`: rewriting it would free the stage
-- it held, and the reminder would go out again.

alter table notifications add column stage text;
--> statement-breakpoint
update notifications n
set stage = coalesce((
  select case
    when d.expires_on is null or d.expires_on - current_date > 7 then 'early'
    when d.expires_on - current_date > 3 then 'week'
    when d.expires_on - current_date > 0 then 'three'
    else 'today'
  end
  from documents d where d.id = n.subject_id
), 'early')
where n.kind = 'expiry.soon';
--> statement-breakpoint
-- `is not null` spelled out: a check that comes to null passes.
alter table notifications add constraint notifications_expiry_stage check (
  (kind = 'expiry.soon' and stage is not null and stage in ('early', 'week', 'three', 'today'))
  or (kind <> 'expiry.soon' and stage is null)
);
--> statement-breakpoint
drop index notifications_expiry_once;
--> statement-breakpoint
create unique index notifications_expiry_once on notifications (user_id, subject_id, stage)
  where kind = 'expiry.soon';
--> statement-breakpoint

do $$
begin
  if has_column_privilege('safehouse_app', 'notifications', 'stage', 'UPDATE') then
    raise exception 'a notification''s stage is updatable';
  end if;
end
$$;
