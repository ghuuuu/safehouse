import { useEffect, useRef } from "react";
import { Form, Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import type { Route } from "./+types/shell";
import { Logo } from "../logo";
import { roleLabel } from "../roles";
import { getSignedInUser } from "../session.server";

/**
 * The index every signed-in page shares (PRODUCT.md, Screens): one sidebar,
 * grouped the way a filing cabinet is used. Find a paper, file one, run the
 * household.
 *
 * Only the signed-in user's own name and role are read here. Nothing about the
 * vault is: each page still reads its own data through `withVault`, and a page
 * a role may not open (Access) still refuses on its own. The link is hidden
 * from non-admins for tidiness, not for security.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSignedInUser(request);
  return { user: user ? { name: user.name, role: user.role } : null };
}

type Item = { to: string; label: string; adminOnly?: boolean };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Find",
    items: [
      { to: "/", label: "Dashboard" },
      { to: "/vault", label: "Vault" },
      { to: "/search", label: "Search" },
      { to: "/tree", label: "Family tree" },
    ],
  },
  {
    title: "File",
    items: [
      { to: "/upload", label: "File a document" },
      { to: "/bulk", label: "File many" },
    ],
  },
  {
    title: "Household",
    items: [
      { to: "/people", label: "People" },
      { to: "/access", label: "Access", adminOnly: true },
      { to: "/settings", label: "Settings" },
    ],
  },
];

/** On a phone, the four things done most, in reach of a thumb; the rest is under More. */
const TABS: Item[] = [
  { to: "/", label: "Dashboard" },
  { to: "/vault", label: "Vault" },
  { to: "/search", label: "Search" },
  { to: "/upload", label: "File" },
];

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  useSlashToSearch();
  // Signed out: the page's own loader has already redirected to sign-in.
  if (!user) return <Outlet />;

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || user.role === "admin"),
  }));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      <aside className="sticky top-0 hidden [view-transition-name:sidebar] h-screen flex-col gap-7 overflow-y-auto bg-side px-4 py-6 text-side-ink md:flex">
        <Link to="/" viewTransition className="flex items-center gap-3 border-b border-side-muted/30 px-2 pb-5">
          <Logo />
          <span className="text-[0.95rem] font-bold uppercase tracking-[0.2em]">Safehouse</span>
        </Link>
        <Link to="/upload" viewTransition className="btn btn-serial mx-2">
          File a document
        </Link>
        <nav aria-label="Safehouse" className="flex flex-col gap-6">
          <Groups groups={groups.map((g) => ({ ...g, items: g.items.filter((i) => i.to !== "/upload") }))} />
        </nav>
        <div className="mt-auto flex flex-col items-start gap-1 border-t border-side-muted/30 pt-4 text-sm">
          <Who user={user} />
        </div>
      </aside>

      {/* Room for the tab bar, so it never covers the end of a page. */}
      <div className="min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </div>

      <TabBar groups={groups} user={user} />
    </div>
  );
}

/**
 * "/" from anywhere goes to search: to the page's own search box when it has
 * one (the dashboard and /search), otherwise to /search, which focuses its
 * box. Not while typing, and not with a modifier held.
 */
function useSlashToSearch() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      const box = document.querySelector<HTMLInputElement>("input[type=search]");
      if (box) box.focus();
      else navigate("/search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

function Groups({ groups, tone = "side" }: { groups: { title: string; items: Item[] }[]; tone?: "side" | "sheet" }) {
  const quiet = tone === "side" ? "text-side-muted" : "text-gray-500";
  const idle = tone === "side" ? "text-side-ink hover:bg-side-hover" : "text-gray-700 hover:bg-gray-100";
  const here = tone === "side" ? "bg-side-on font-semibold text-side-on-ink" : "bg-accent font-semibold text-on-accent";
  return groups.map((group) => (
    <div key={group.title}>
      {/* Not a heading: the page's own h1 is the first heading a reader meets. */}
      <p aria-hidden className={`index mb-1.5 px-3 ${quiet}`}>{group.title}</p>
      <ul aria-label={group.title} className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              viewTransition
              end={item.to === "/"}
              className={({ isActive }) =>
                "block rounded-md px-3 py-2.5 text-sm md:py-1.5 " + (isActive ? here : idle)
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  ));
}

function Who({ user, tone = "side" }: { user: { name: string; role: string }; tone?: "side" | "sheet" }) {
  return (
    <>
      <p className={`px-3 ${tone === "side" ? "text-side-ink" : "text-gray-700"}`}>
        {user.name}
        <span className={`block text-xs ${tone === "side" ? "text-side-muted" : "text-gray-500"}`}>{roleLabel(user.role)}</span>
      </p>
      <Form method="post" action="/sign-out">
        <button
          className={`rounded-md px-3 py-2 underline ${tone === "side" ? "text-side-ink hover:bg-side-hover" : "text-gray-700 hover:bg-gray-100"}`}
          type="submit"
        >
          Sign out
        </button>
      </Form>
    </>
  );
}

/**
 * The phone's navigation: four tabs and More. More is a native disclosure, so
 * it works before the page's script has loaded; it closes itself when a link
 * in it is followed, or on Escape.
 */
function TabBar({ groups, user }: { groups: { title: string; items: Item[] }[]; user: { name: string; role: string } }) {
  const more = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    more.current?.removeAttribute("open");
  }, [location.pathname, location.search]);

  const tabTargets = new Set(TABS.map((t) => t.to));
  const inMore = groups.some((g) => g.items.some((i) => !tabTargets.has(i.to) && location.pathname.startsWith(i.to)));
  const tab = "flex h-16 flex-col items-center justify-center text-xs";

  return (
    <nav
      aria-label="Safehouse"
      className="fixed inset-x-0 bottom-0 z-20 [view-transition-name:tabbar] bg-side pb-[env(safe-area-inset-bottom)] text-side-ink md:hidden"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              viewTransition
              end={item.to === "/"}
              className={({ isActive }) => `${tab} ${isActive ? "font-semibold text-side-ink" : "text-side-muted"}`}
            >
              {({ isActive }) => (
                <>
                  <span aria-hidden className={`mb-1.5 h-0.5 w-7 ${isActive ? "bg-serial" : "bg-transparent"}`} />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li>
          <details
            ref={more}
            onKeyDown={(event) => {
              if (event.key === "Escape") more.current?.removeAttribute("open");
            }}
          >
            <summary className={`${tab} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${inMore ? "font-semibold text-side-ink" : "text-side-muted"}`}>
              <span aria-hidden className={`mb-1.5 h-0.5 w-7 ${inMore ? "bg-serial" : "bg-transparent"}`} />
              More
            </summary>
            <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto border-t-2 border-side bg-white px-4 py-4 text-gray-900">
              <div className="flex flex-col gap-4">
                <Groups
                  tone="sheet"
                  groups={groups
                    .map((g) => ({ ...g, items: g.items.filter((i) => !tabTargets.has(i.to)) }))
                    .filter((g) => g.items.length > 0)}
                />
                <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-3 text-sm">
                  <Who user={user} tone="sheet" />
                </div>
              </div>
            </div>
          </details>
        </li>
      </ul>
    </nav>
  );
}
