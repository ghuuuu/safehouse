import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // The first administrator, creatable only while there are no accounts.
  route("setup", "routes/setup.tsx"),
  // The vault, optionally through somebody else's eyes: /vault?as=<userId>.
  route("vault", "routes/vault.tsx"),
  // Who documents can be filed to, and the admin's form for adding somebody.
  route("people", "routes/people.tsx"),
  // The family tree; a click opens /vault?owner= for that person.
  route("tree", "routes/tree.tsx"),
  // Who can see what, admin only: /access?as=<userId> for one account's panel
  // (the only place grants are edited), /access?view=matrix for the audit grid.
  route("access", "routes/access.tsx"),
  // Filing a document: the only surface that writes to the vault.
  route("upload", "routes/upload.tsx"),
  // One record: its fields, its pages, its versions.
  route("record/:documentId", "routes/record.$documentId.tsx"),
  // The bytes themselves, behind a step-up password check (D4).
  route("file/:fileId", "routes/file.$fileId.tsx"),
  route("verify", "routes/verify.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  // Where an invite or reset link lands. Public: the link is the credential.
  route("set-password", "routes/set-password.tsx"),
  route("sign-out", "routes/sign-out.tsx"),
  // Sign-in, sign-out and session, served by the auth library (D10).
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
