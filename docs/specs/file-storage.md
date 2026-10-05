# Spec: File storage and envelope encryption

Status: **implemented** — round trip, tampering, cross-row binding and
rotation all covered by tests; no HTTP surface reaches it yet
Relates to: DECISIONS.md D5, D12, D6, D20; PRODUCT.md "Core model"

## Objective

Put a document file on disk so that the disk alone is worthless, and get it
back byte-identical. No HTTP surface in this step: upload and download are the
two steps after it, and this is the thing both of them call.

**Why this is built alone.** D5 calls key management "the decision most likely
to be got wrong quietly". A mistake here is silent at the time and permanent
afterwards — a file written under a lost key is gone, and a file written in
plaintext looks identical to one written correctly from everywhere except the
disk. It gets its own module, its own tests, and no route that could reach it
before those tests exist.

## Scope

In: the key provider, envelope encryption, and blob storage on local disk.
Round-trip proof. Key rotation that re-wraps data keys.

Out: anything that speaks HTTP, the write policies that let a user create a
document row (the next step), page extraction, thumbnails, deduplication.

## Design

### Envelope encryption, as D12 settles it

Every file gets a fresh 32-byte data key. The file is encrypted under that key
with AES-256-GCM. The data key is then encrypted under a single
key-encryption key — the KEK — which lives in a file mounted as a Docker secret
and is read once at boot.

Rotating the KEK re-wraps data keys and never rewrites a document file, which
is the entire reason for the indirection.

### What goes where

Three places, and the split is the point: the ciphertext is on disk, the wrapped
key is in the database, and the KEK is in neither.

```
document_files.nonce        12 bytes   the file's GCM nonce
document_files.wrapped_dek  65 bytes   version(1) ‖ keyId(4) ‖ nonce(12) ‖ ciphertext(32) ‖ tag(16)
<storage dir>/<key>         N+16       the file's ciphertext ‖ its GCM tag
```

`wrapped_dek` is self-describing on purpose. The version byte is there because
the first format decision is never the last one. The four-byte key id — the
first four bytes of `sha256(KEK)` — is what makes rotation safe to interrupt: a
half-finished rotation leaves rows wrapped under two different keys, and
without a key id there is no way to tell which is which except by trying, which
is how a vault loses files. It identifies the key without revealing it.

The file's GCM tag is appended to the ciphertext rather than given a column,
because it belongs to the bytes and travels with them.

### Bound to its row

Both encryptions take the file row's id as additional authenticated data. A
ciphertext therefore decrypts only in the row it was written for: somebody with
write access to the storage volume cannot swap the bytes of one file for the
bytes of another and have the result open. GCM verifies this before it returns
a single plaintext byte.

### The storage key carries no meaning

`<first two hex chars of the file id>/<file id>`. Opaque, derived, and flat
enough that no directory holds every file. A path like
`maya/passport-2024.jpg` would put a record field value in a directory listing,
in a backup manifest, and in any error that prints a path — CLAUDE.md says
never log file names, and a name that is itself the data makes that impossible
to honour.

### sha256 is of the plaintext

It is there to answer "did this come back the way it went in", which is the
question a restore drill asks (D6). A hash of the ciphertext cannot answer it.

The tradeoff, stated rather than implied: anybody holding the database can
confirm whether a *specific file they already have* is in the vault, by hashing
it. They cannot learn anything about a file they do not already hold. D14
already accepts readable identifiers in the database on the condition that
Postgres is never reachable from outside the container network, and this is a
smaller disclosure than the one that decision already took.

### The key provider is an interface with one implementation

D12 requires that adding passphrase unlock later must not touch the schema, so
the KEK arrives through a provider rather than from a path read inline. One
implementation today: a file, read once at boot, 32 bytes as hex or base64 so
that the printed-on-paper custody D12 asks for is something a person can
actually type back in.

A missing or malformed key file stops the server at boot, by name, the way
`requireEnv` does. The alternative — starting and failing at the first upload —
means discovering it when somebody is trying to file a passport.

## Project structure

```
app/keys.server.ts        the KEK: read it, identify it, never print it   (new)
app/keys.server.test.ts   parsing, refusals, key id stability             (new)
app/crypto.server.ts      seal and open a file; rewrap for rotation       (new)
app/crypto.server.test.ts round trip, tamper, wrong key, cross-row        (new)
app/storage.server.ts     put, get, delete a blob by storage key          (new)
app/storage.server.test.ts round trip on a temp directory                 (new)
docker-compose.yml        the key secret and the document volume          (modified)
.env.example              SAFEHOUSE_KEY_FILE, SAFEHOUSE_STORAGE_DIR       (modified)
scripts/make-key.mjs      generate a key file, refuse to overwrite one    (new)
```

## Testing strategy

1. **Round trip.** Seal a known plaintext, write it, read it, open it: identical
   bytes, identical sha256.
2. **The disk is worthless.** The bytes written are not the plaintext, do not
   contain it, and do not open without the KEK.
3. **Tamper.** Flip one byte of the ciphertext, one byte of the tag, one byte of
   the wrapped key: each fails to open, with an error rather than with garbage.
4. **Cross-row.** The ciphertext of file A, placed at file B's storage key with
   B's row, does not open. This is the AAD assertion.
5. **Wrong key.** A different KEK does not open it, and says so.
6. **Rotation.** Re-wrap under a new KEK: the file on disk is untouched
   (compare mtime and bytes), the plaintext still opens, the old KEK no longer
   opens it, and the key id changed.
7. **Key file refusals.** Absent, empty, wrong length, not hex or base64 — each
   refused at boot by name.

A test that writes to the real storage directory is a test that can delete a
real document, so every storage test gets its own temporary directory.

## Boundaries

**Always**
- Generate the data key with a CSPRNG, per file, never derived from anything.
- Fail closed: any decryption failure is an error, never a partial read.
- `openFile` verifies the tag before returning any plaintext (GCM does this; do
  not use `update` output without `final`).

**Never**
- Log a plaintext, a key, a storage key, a file name, or a mime type with a
  name in it (CLAUDE.md).
- Put the KEK in the database, in the storage volume, or in a backup (D12).
- Reuse a nonce under the same key.
- Write the plaintext to disk at any point, including as a temporary file.
- Catch a decryption error and return empty bytes.

## Success criteria

- [ ] A sealed file round-trips byte-identically through disk.
- [ ] The file on disk shares no 16-byte run with its plaintext.
- [ ] Every tamper case in the testing strategy fails closed.
- [ ] A file sealed for one row does not open in another.
- [ ] Rotation re-wraps every data key, leaves every document file untouched,
      and is safe to interrupt and resume.
- [ ] A missing or malformed key file stops boot with a named error.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` pass.

## Open questions

1. **Maximum file size.** Sealing buffers the whole file in memory, which is
   fine for a scan and not fine for a video. A ceiling has to exist before an
   HTTP surface does; the upload step picks the number.
2. **Where the key file lives in development.** `keys/` is already gitignored.
   A developer with no key file should get a one-command way to make one rather
   than a stack trace, which is why `scripts/make-key.mjs` is in this step.
