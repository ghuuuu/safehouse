import { Form, Link, NavLink, Outlet } from "react-router";

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

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  // Signed out: the page's own loader has already redirected to sign-in.
  if (!user) return <Outlet />;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13rem_1fr]">
      <aside className="flex flex-col gap-4 border-b border-gray-200 bg-gray-50 px-4 py-4 md:sticky md:top-0 md:h-screen md:gap-8 md:border-r md:border-b-0 md:px-5 md:py-8">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Safehouse
        </Link>

        <nav aria-label="Safehouse" className="flex flex-wrap gap-x-1 gap-y-1 md:flex-col md:gap-6">
          {GROUPS.map((group) => (
            <div key={group.title} className="contents md:block">
              <h2 className="mb-1 hidden px-2 text-xs font-medium text-gray-500 md:block">{group.title}</h2>
              <ul className="contents md:flex md:flex-col md:gap-0.5">
                {group.items
                  .filter((item) => !item.adminOnly || user.role === "admin")
                  .map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) =>
                          "block rounded-md px-2 py-1.5 text-sm " +
                          (isActive ? "bg-white font-medium ring-1 ring-gray-200" : "text-gray-600 hover:bg-gray-100")
                        }
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2 text-sm md:mt-auto md:flex-col md:items-start">
          <p className="text-gray-600">
            {user.name}
            <span className="block text-xs text-gray-500">{roleLabel(user.role)}</span>
          </p>
          <Form method="post" action="/sign-out">
            <button className="rounded-md px-2 py-1.5 text-gray-600 underline hover:bg-gray-100" type="submit">
              Sign out
            </button>
          </Form>
        </div>
      </aside>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
