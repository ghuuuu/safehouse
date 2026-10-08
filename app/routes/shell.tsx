import { useEffect, useRef } from "react";
import { Form, Link, NavLink, Outlet, useLocation } from "react-router";

import type { Route } from "./+types/shell";
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
  // Signed out: the page's own loader has already redirected to sign-in.
  if (!user) return <Outlet />;

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || user.role === "admin"),
  }));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-8 border-r border-gray-200 bg-gray-50 px-5 py-8 md:flex">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Safehouse
        </Link>
        <nav aria-label="Safehouse" className="flex flex-col gap-6">
          <Groups groups={groups} />
        </nav>
        <div className="mt-auto flex flex-col items-start gap-2 text-sm">
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

function Groups({ groups }: { groups: { title: string; items: Item[] }[] }) {
  return groups.map((group) => (
    <div key={group.title}>
      <h2 className="mb-1 px-2 text-xs font-medium text-gray-500">{group.title}</h2>
      <ul className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                "block rounded-md px-2 py-2.5 text-sm md:py-1.5 " +
                (isActive ? "bg-white font-medium ring-1 ring-gray-200" : "text-gray-600 hover:bg-gray-100")
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

function Who({ user }: { user: { name: string; role: string } }) {
  return (
    <>
      <p className="px-2 text-gray-600">
        {user.name}
        <span className="block text-xs text-gray-500">{roleLabel(user.role)}</span>
      </p>
      <Form method="post" action="/sign-out">
        <button className="rounded-md px-2 py-2 text-gray-600 underline hover:bg-gray-100" type="submit">
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
      className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-gray-50 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `${tab} ${isActive ? "font-semibold text-gray-900" : "text-gray-600"}`}
            >
              {({ isActive }) => (
                <>
                  <span aria-hidden className={`mb-1 h-1 w-6 rounded-full ${isActive ? "bg-gray-900" : "bg-transparent"}`} />
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
            <summary className={`${tab} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${inMore ? "font-semibold text-gray-900" : "text-gray-600"}`}>
              <span aria-hidden className={`mb-1 h-1 w-6 rounded-full ${inMore ? "bg-gray-900" : "bg-transparent"}`} />
              More
            </summary>
            <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto border-t border-gray-200 bg-gray-50 px-4 py-4">
              <div className="flex flex-col gap-4">
                <Groups
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
