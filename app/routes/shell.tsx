import { useEffect, useRef } from "react";
import { Form, Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/shell";
import { Icon, type IconName } from "../icons";
import { Logo } from "../logo";
import { roleLabel } from "../roles";
import { getSignedInUser, withVault } from "../session.server";

/**
 * The index every signed-in page shares (PRODUCT.md, Screens): one sidebar,
 * grouped the way a filing cabinet is used. Find a paper, file one, run the
 * household.
 *
 * Read here: the signed-in user's own name and role, and how many drafts they
 * reach (D40), counted through `intakes_reach` so it is their own or, for an
 * admin, everybody's. Nothing about the vault's documents: each page reads
 * its own data through `withVault`, and a page a role may not open (Access)
 * still refuses on its own. The link is hidden from non-admins for tidiness,
 * not for security.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSignedInUser(request);
  if (!user) return { user: null, drafts: 0 };
  const drafts =
    user.role === "admin" || user.role === "individual"
      ? await withVault(request, async (db) => {
          const [row] = [...(await db.execute<{ n: number }>(sql`select count(*)::int as n from intakes`))];
          return row?.n ?? 0;
        })
      : 0;
  return { user: { name: user.name, role: user.role }, drafts };
}

type Item = { to: string; label: string; icon: IconName; adminOnly?: boolean; fileOnly?: boolean; count?: number };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Find",
    items: [
      { to: "/", label: "Dashboard", icon: "home" },
      { to: "/vault", label: "Vault", icon: "vault" },
      { to: "/folders", label: "Folders", icon: "folder" },
      { to: "/search", label: "Search", icon: "search" },
      { to: "/tree", label: "Family tree", icon: "tree" },
    ],
  },
  {
    title: "File",
    items: [
      { to: "/upload", label: "File a document", icon: "file", fileOnly: true },
      { to: "/bulk", label: "File many", icon: "many", fileOnly: true },
      { to: "/unfinished", label: "Unfinished", icon: "unfinished", fileOnly: true },
    ],
  },
  {
    title: "Household",
    items: [
      { to: "/people", label: "People", icon: "people" },
      { to: "/access", label: "Access", icon: "access", adminOnly: true },
      { to: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

/** On a phone, the four things done most, in reach of a thumb; the rest is under More. */
const TABS: Item[] = [
  { to: "/", label: "Dashboard", icon: "home" },
  { to: "/vault", label: "Vault", icon: "vault" },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/upload", label: "File", icon: "file" },
];

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user, drafts } = loaderData;
  useSlashToSearch();
  // Signed out: the page's own loader has already redirected to sign-in.
  if (!user) return <Outlet />;

  // Presentation, like adminOnly: `intakes_start` (0017) refuses a draft from
  // anybody else, and /upload says so. A third party or an emergency contact
  // is simply not offered a way to file.
  const canFile = user.role === "admin" || user.role === "individual";
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => !item.adminOnly || user.role === "admin")
      .filter((item) => !item.fileOnly || canFile)
      .map((item) => (item.to === "/unfinished" ? { ...item, count: drafts } : item)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden [view-transition-name:sidebar] h-screen flex-col gap-6 overflow-y-auto border-r border-gray-100 bg-side px-3 py-5 text-side-ink md:flex">
        <Link to="/" viewTransition className="flex items-center justify-center gap-3 rounded-lg px-2 py-1 no-underline">
          <Logo size={44} />
          <span className="text-[1.75rem] font-semibold tracking-[-0.025em] text-gray-950">SafeHouse</span>
        </Link>
        {canFile ? (
          <Link to="/upload" viewTransition className="btn btn-primary mx-1 no-underline">
            <Icon name="file" size={16} />
            File a document
          </Link>
        ) : null}
        <nav aria-label="SafeHouse" className="flex flex-col gap-5">
          <Groups groups={groups.map((g) => ({ ...g, items: g.items.filter((i) => i.to !== "/upload") }))} />
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-100 px-1 pt-4 text-sm">
          <Who user={user} />
        </div>
      </aside>

      {/* Room for the tab bar, so it never covers the end of a page. */}
      <div className="min-w-0 pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
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
  return groups.map((group) => (
    <div key={group.title}>
      {/* Not a heading: the page's own h1 is the first heading a reader meets. */}
      <p aria-hidden className="index mb-1 px-2.5 text-side-muted">{group.title}</p>
      <ul aria-label={group.title} className="flex flex-col gap-px">
        {group.items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              viewTransition
              end={item.to === "/"}
              className={({ isActive }) =>
                "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm no-underline transition-colors duration-150 md:py-[0.4rem] " +
                (isActive ? "font-medium text-side-on-ink" : "text-side-ink hover:bg-side-hover")
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    // The honey mark on where you are. In the sidebar it is
                    // named, so a page change glides it to the new row.
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-lg bg-side-on"
                      style={tone === "side" ? { viewTransitionName: "nav-here" } : undefined}
                    />
                  ) : null}
                  <Icon name={item.icon} className={"relative " + (isActive ? "text-accent" : "text-side-muted")} />
                  <span className="relative flex-1">{item.label}</span>
                  {item.count ? (
                    <span className="relative font-mono text-xs text-side-muted">
                      {item.count}
                      <span className="sr-only"> waiting</span>
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  ));
}

function Who({ user }: { user: { name: string; role: string } }) {
  return (
    <>
      <p className="min-w-0 px-1.5 text-gray-900">
        <span className="block truncate font-medium">{user.name}</span>
        <span className="block text-xs text-gray-500">{roleLabel(user.role)}</span>
      </p>
      <Form method="post" action="/sign-out" className="shrink-0">
        <button
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm text-gray-500 transition-colors hover:bg-side-hover hover:text-gray-900"
          type="submit"
        >
          <Icon name="out" size={16} />
          Sign out
        </button>
      </Form>
    </>
  );
}

/**
 * The phone's navigation: four tabs and More, on a translucent bar. More is a
 * native disclosure, so it works before the page's script has loaded; it
 * closes itself when a link in it is followed, or on Escape.
 */
function TabBar({ groups, user }: { groups: { title: string; items: Item[] }[]; user: { name: string; role: string } }) {
  const more = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    more.current?.removeAttribute("open");
  }, [location.pathname, location.search]);

  // Somebody who cannot file gets Folders where File would be.
  const canFile = user.role === "admin" || user.role === "individual";
  const tabs = canFile ? TABS : TABS.map((t) => (t.to === "/upload" ? { to: "/folders", label: "Folders", icon: "folder" as const } : t));
  const tabTargets = new Set(tabs.map((t) => t.to));
  const inMore = groups.some((g) => g.items.some((i) => !tabTargets.has(i.to) && location.pathname.startsWith(i.to)));
  const tab = "flex h-[4.25rem] flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium no-underline transition-colors";

  return (
    <nav
      aria-label="SafeHouse"
      className="fixed inset-x-0 bottom-0 z-20 [view-transition-name:tabbar] border-t border-gray-100 bg-side/85 pb-[env(safe-area-inset-bottom)] text-side-ink backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <ul className="grid grid-cols-5">
        {tabs.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              viewTransition
              end={item.to === "/"}
              className={({ isActive }) => `${tab} ${isActive ? "text-accent" : "text-side-muted"}`}
            >
              <Icon name={item.icon} size={22} />
              {item.label}
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
            <summary className={`${tab} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${inMore ? "text-accent" : "text-side-muted"}`}>
              <Icon name="more" size={22} />
              More
            </summary>
            <div
              className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-200 bg-[var(--raised)] px-3 py-4 text-gray-900"
              style={{ boxShadow: "var(--shadow-float)" }}
            >
              <div className="flex flex-col gap-4">
                <Groups
                  tone="sheet"
                  groups={groups
                    .map((g) => ({ ...g, items: g.items.filter((i) => !tabTargets.has(i.to)) }))
                    .filter((g) => g.items.length > 0)}
                />
                <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-3 text-sm">
                  <Who user={user} />
                </div>
              </div>
            </div>
          </details>
        </li>
      </ul>
    </nav>
  );
}
