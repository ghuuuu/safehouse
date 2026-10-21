# Safehouse — Operations

How to keep a running vault alive: backups on a schedule, upgrades, putting
one back, and the two things nobody can fix for you. The commands are in
`CLAUDE.md`; this is when to run them and what to do when they fail.

Everything here runs on the server, from the checkout, with `.env` in place and
the database up (`docker compose up -d db`). The app container cannot do any of
it: it has no owner credentials, on purpose (D22).

---

## What there is to keep

| Thing | Where | In a backup |
|---|---|---|
| The database | the `db-data` Docker volume | yes, encrypted under the key |
| The documents | the host directory `SAFEHOUSE_STORAGE_DIR` (`./storage`) | yes, copied as-is; every file is already sealed |
| The key file | `SAFEHOUSE_KEY_FILE` (`./keys/safehouse.key`) | **never** |
| `.env` | the checkout | no; it holds passwords, keep a copy with the key |

A backup without the key opens nothing. The key without a backup opens nothing.
You need both, kept in different places.

The documents live in a host directory rather than a Docker volume so that
`npm run backup` and `npm run restore` reach the files the app writes (D38). The
app runs as uid 1000. On Linux, before the first `docker compose up`:

```sh
mkdir -p storage && sudo chown 1000:1000 storage
```

If you skip it, Docker creates the directory as root and the server refuses to
start, saying which directory it cannot write.

---

## Reaching it from other devices

As shipped, the app answers plain HTTP on port 4020 on every network interface
of the machine. Anybody on the same Wi-Fi can read what crosses it: passwords,
session cookies, the papers themselves. Before the vault holds real papers, put
TLS in front of it:

1. Something that speaks https on the same machine and forwards to
   `127.0.0.1:4020`: Caddy (`reverse_proxy 127.0.0.1:4020`, with `tls internal`
   for a name only your network knows, whose root each device then trusts), or
   `tailscale serve`, which gives the machine an https name inside your tailnet.
2. `BETTER_AUTH_URL` in `.env` set to that https address. It is what marks the
   cookies Secure — the session's and the step-up's alike — so a browser never
   sends them over plain HTTP. Left at `http://`, they are sent in the clear.
3. The app's port bound to loopback in `docker-compose.yml`
   (`"127.0.0.1:4020:3000"`), so nothing on the network can go around the proxy.

---

## The key

**If the key file is lost, every document in the vault is gone. Nobody can get
them back:** not you, not whoever wrote this software, not with the database,
not with every backup you ever made. That is what makes a stolen backup
worthless, and it cuts both ways (D12).

So, before the vault holds anything real:

1. `npm run key:make` prints the key once. Write it down, or put it in a
   password manager that does not live on this server. Read the copy back
   against `keys/safehouse.key`; 64 characters copied with one wrong is a lost
   key.
2. Keep that copy somewhere a fire, a theft or a dead disk at home would not
   reach.
3. On the dashboard, an admin presses **I have a copy of the key somewhere
   else**. Until then every admin is reminded on every visit. The answer is
   recorded against the key's id, so a replaced key asks again.

What losing it looks like: the server will not start, and says that the key it
has opens none of the vault's files (D31). There is nothing to fix in the
software. If the old key turns up, put it back at `SAFEHOUSE_KEY_FILE` and
start the server. If it never does, the only way forward is a new vault: a new
database, a new key, and every document filed again from paper. Do not run
`npm run key:make` over the old key to "get it working": it refuses, and the
refusal is the point.

---

## Backups on a schedule

D6 says a backup that has never been restored is not a backup, so the schedule
is a backup **and** a drill. The drill restores the newest backup into a
throwaway database, opens real documents out of it, checks every byte, and
drops the throwaway. When it passes it records the fact in the vault, and the
admins' dashboard says so when the newest backup proven to restore is more
than eight days old. A schedule that silently stopped therefore turns into a
warning within a week.

Weekly at the least, nightly if documents are filed often. On Linux, `crontab -e`:

```cron
# Safehouse: back up and prove it, Sundays 03:00
0 3 * * 0  cd /srv/safehouse && npm run backup && npm run backup:drill >> backups/drill.log 2>&1
```

On Windows, a Task Scheduler task running `cmd /c "cd /d C:\safehouse && npm run backup && npm run backup:drill"`.

**Off the machine.** A backup on the same disk as the vault survives a
mistake, not a fire. Copy `./backups` somewhere else after each run: another
machine, a USB drive kept elsewhere, or a cloud bucket (`rclone sync`,
`rsync`). It is safe to hand to a cloud provider: the database is encrypted and
every document is sealed, and the key is not in it. `npm run backup` searches
what it wrote for the key before it finishes.

**Pruning.** Each backup is a full copy of the store. Keep the last few and
delete the rest, for example:

```sh
ls -d backups/safehouse-* | head -n -8 | xargs rm -rf   # keep the newest 8
```

**When the drill fails.** Its last line says why. A failed drill means the
backup it tried cannot be trusted. Fix that before anything else, and keep the
previous backups until a new one passes. "Unopenable under the current key"
is not a restore failure: those files were sealed under a key this machine no
longer has (see the key, above).

---

## Upgrading

Migrations change the schema of a vault with real documents in it, and they
only go forward. So every upgrade starts from a backup that has just been proven
to restore:

```sh
git pull
npm ci
docker compose stop app          # nothing writes while the schema changes
npm run upgrade                  # backup → drill → migrate, stopping at the first failure
docker compose up -d --build app
docker compose logs app          # it starts, or it says why not
```

`npm run upgrade` refuses to migrate if the backup or the drill fails. The
migrations themselves are applied in one transaction: if one fails, none of
that upgrade's are applied, and the vault is exactly as it was. In that case go
back to the previous version (`git checkout <the commit you were on>`, then
`docker compose up -d --build app`) and report the failure.

**Going back after a migration succeeded.** The schema cannot be walked
backwards. Restore the backup `npm run upgrade` just took, on the version you
upgraded from:

```sh
docker compose stop app
git checkout <the commit you were on> && npm ci
npm run restore -- ./backups/<the backup from the upgrade> --force
npm run db:setup
docker compose up -d --build app
```

Anything filed between the upgrade and the restore is lost from the database.
Its sealed file stays in the store, unreferenced.

A restore never writes over the live database. It restores into a new one
beside it, in one transaction, and swaps the names only once that has worked;
a failure leaves the live vault as it was. The database it replaced is kept as
`safehouse_before_restore_<time>`, and the command prints how to drop it once
the restored vault is working. The swap needs the app stopped: with it running,
the restore stops before changing anything and says so.

---

## Putting a vault back

On the worst day: a dead disk, a new machine.

1. Clone the repository at the version the backup was taken on or later.
   `.env` and the key file go back where they were.
2. `docker compose up -d db`
3. `npm run backup:drill -- <backup>`. It costs nothing and tells you whether
   the backup and the key belong together before you rely on them.
4. `npm run restore -- <backup>`. It refuses a database that already has
   accounts unless you add `--force` and type the account count.
5. `npm run db:migrate`. This creates the roles the app connects as, which are
   not in a dump, brings an older backup's schema forward, and seals any
   identifier a backup from before D35 holds in the clear.
6. On Linux, `sudo chown -R 1000:1000 storage`, then `docker compose up -d --build`.

---

## A member lost their second factor

They have lost both their phone and their backup codes. There is no screen for
this yet. As the owner, from the server:

```sh
docker compose exec -T db psql -U safehouse -d safehouse <<'SQL'
delete from two_factors where user_id = (select id from users where email = 'them@example.invalid');
update users set two_factor_enabled = false where email = 'them@example.invalid';
SQL
```

They sign in with their password alone, and should turn two-factor back on
from Settings straight away.
