import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useSubmit,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { getSignedInUser, withVault } from "./session.server";
import { readSettings } from "./settings.server";

/**
 * Only what auto-lock needs: how long, and only for somebody signed in.
 * A signed-out page (sign-in, set-password) gets nothing and no timer.
 */
export async function loader({ request }: Route.LoaderArgs) {
  if (!(await getSignedInUser(request))) return { autoLockMinutes: null };
  const settings = await withVault(request, (db) => readSettings(db));
  return { autoLockMinutes: settings?.autoLockMinutes ?? null };
}

/**
 * Auto-lock (D36): a page nobody has touched for the household's interval
 * signs itself out, the same POST as the sign-out button.
 *
 * ponytail: enforced by the page, so a closed laptop with the tab asleep locks
 * when it wakes, not on the minute. The server's own session lifetime is the
 * backstop; enforcing idleness there needs a session touch on every request.
 */
function AutoLock({ minutes }: { minutes: number }) {
  const submit = useSubmit();

  useEffect(() => {
    const limit = minutes * 60_000;
    let last = Date.now();
    const touch = () => (last = Date.now());
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));

    const check = window.setInterval(() => {
      if (Date.now() - last >= limit) {
        window.clearInterval(check);
        submit(null, { method: "post", action: "/sign-out" });
      }
    }, 15_000);

    return () => {
      window.clearInterval(check);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [minutes, submit]);

  return null;
}

export const links: Route.LinksFunction = () => [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }];

// Fonts are not loaded from a third party. A private vault should not tell
// anyone else's server which pages the household is opening.


export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <>
      {loaderData.autoLockMinutes ? <AutoLock minutes={loaderData.autoLockMinutes} /> : null}
      <Outlet />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
