import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // The first administrator, creatable only while there are no accounts.
  route("setup", "routes/setup.tsx"),
  // The vault, optionally through somebody else's eyes: /vault?as=<userId>.
  route("vault", "routes/vault.tsx"),
  // Filing a document: the only surface that writes to the vault.
  route("upload", "routes/upload.tsx"),
  // The bytes themselves, behind a step-up password check (D4).
  route("file/:fileId", "routes/file.$fileId.tsx"),
  route("verify", "routes/verify.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  route("sign-out", "routes/sign-out.tsx"),
  // Sign-in, sign-out and session, served by the auth library (D10).
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
