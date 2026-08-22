import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // The first administrator, creatable only while there are no accounts.
  route("setup", "routes/setup.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  route("sign-out", "routes/sign-out.tsx"),
  // Sign-in, sign-out and session, served by the auth library (D10).
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
