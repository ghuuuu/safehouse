import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // Sign-in, sign-out and session, served by the auth library (D10).
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
