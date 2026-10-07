-- Which key-encryption keys the vault's files are wrapped under (D31).
--
-- The server asks this once, at boot, and refuses to start under a key that
-- opens none of them. It is asked before anybody has signed in, so no user is
-- set, every policy matches nothing, and an ordinary query would say the vault
-- is empty — which is exactly the answer that would let a wrong key through.
--
-- So it is the one question the application may ask about every row without
-- naming who is asking, and it is pinned down accordingly:
--
--   * It returns key ids and nothing else. Four bytes of a hash of the key,
--     already written into every wrapped data key; not a file, not a count,
--     not an owner. "Which keys" is all boot needs.
--   * Version-1 wrapped keys only, by their first byte and length. The fixture's
--     placeholder bytes are not a key and must not read as a second one.
--   * Zero arguments, a pinned search_path and qualified names, like every
--     security definer function here (D25). It lives in `public` rather than
--     `perm` because the application calls it by name, and `perm` is the schema
--     the application must never be able to name.
--   * EXECUTE for the application role only. The sign-in role has no business
--     knowing anything about files (D24).

create function public.vault_key_ids() returns setof bytea
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct substring(f.wrapped_dek from 2 for 4)
  from public.document_files f
  where length(f.wrapped_dek) = 65
    and get_byte(f.wrapped_dek, 0) = 1
$$;
--> statement-breakpoint
revoke all on function public.vault_key_ids() from public;
--> statement-breakpoint
grant execute on function public.vault_key_ids() to safehouse_app;
