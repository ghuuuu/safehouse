import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Every signed-in page, inside the shared sidebar (routes/shell.tsx).
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    // The vault, optionally through somebody else's eyes: /vault?as=<userId>.
    route("vault", "routes/vault.tsx"),
    // Who documents can be filed to, and the admin's form for adding somebody.
    route("people", "routes/people.tsx"),
    // The family tree; a click opens /vault?owner= for that person.
    route("tree", "routes/tree.tsx"),
    // Who can see what, admin only: /access?as=<userId> for one account's panel
    // (the only place grants are edited), /access?view=matrix for the audit grid.
    route("access", "routes/access.tsx"),
    // Filing a document: photos and PDFs into a draft (D40), then to review.
    route("upload", "routes/upload.tsx"),
    // Many files at once, sorted in the browser, sent one per request to
    // bulk/file (JSON), each made into its own draft and read.
    route("bulk", "routes/bulk.tsx"),
    // A draft: its pages straightened and sized, its details checked, then
    // filed as one PDF (D39, D40). The only surface that files into the vault.
    // Drafts waiting to be filed, and papers filed as images, to convert.
    route("unfinished", "routes/unfinished.tsx"),
    route("intake/:intakeId", "routes/intake.$intakeId.tsx"),
    route("intake/:intakeId/corners/:pageId", "routes/intake.$intakeId.corners.$pageId.tsx"),
    // Words and numbers, through the policies; /search?q=…&as=<userId> for view-as.
    route("search", "routes/search.tsx"),
    // One record: its fields, its pages, its versions.
    route("record/:documentId", "routes/record.$documentId.tsx"),
    // Account, two-factor, devices, and (admin) the household's settings.
    route("settings", "routes/settings.tsx"),
  ]),
  // The first administrator, creatable only while there are no accounts.
  route("setup", "routes/setup.tsx"),
  route("bulk/file", "routes/bulk.file.ts"),
  // One page of a draft, as an image or a one-page PDF, behind step-up (D4).
  route("intake/:intakeId/page/:pageId", "routes/intake.$intakeId.page.$pageId.ts"),
  // The bytes themselves, behind a step-up password check (D4).
  route("file/:fileId", "routes/file.$fileId.tsx"),
  route("verify", "routes/verify.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  // The second half of signing in, when two-factor is on (D36).
  route("sign-in/code", "routes/sign-in.code.tsx"),
  // Where an invite or reset link lands. Public: the link is the credential.
  route("set-password", "routes/set-password.tsx"),
  route("sign-out", "routes/sign-out.tsx"),
  // Sign-in, sign-out and session, served by the auth library (D10).
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
