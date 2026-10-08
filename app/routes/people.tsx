import { Form, useNavigation } from "react-router";

import type { Route } from "./+types/people";
import { ACTIONS, record } from "../activity.server";
import {
  PARENT_TYPES,
  RELATIONS,
  SEXES,
  type Link as PersonLink,
  type ParentType,
} from "../people";
import { sql } from "drizzle-orm";

import { inviteToSignIn, NotAllowed, signInLinkFor } from "../auth.server";
import { addPerson, listAnchors, listHousehold } from "../people.server";
import { withVault } from "../session.server";

export function meta() {
  return [{ title: "People — Safehouse" }];
}

/**
 * How this surface enforces access.
 *
 * The roster is `select ... from owners left join people left join users`, with
 * no permission logic in it. All three tables carry row-level security, so a
 * third party sees the one business they were granted and a member sees their
 * own circle — and because `users_read` hands out your own row and the whole
 * table to an admin, somebody else's login comes back as null rather than being
 * filtered out here.
 *
 * `canAdd` below is presentation and nothing else. It decides whether the form
 * is drawn; `0009_person_writes.sql` decides whether the insert is allowed, and
 * a hand-posted form from a member is refused by the database. The one rule in
 * CLAUDE.md is not enforced by this file.
 *
 * Writes go through `withVault`, never `withViewedVault`: an admin looking
 * through somebody else's eyes is in a read-only transaction and could not add
 * a person even if this route tried.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    const canAdd = user.role === "admin";

    // Only asked for when the form will be drawn. Not a permission measure —
    // `listAnchors` is policy-filtered like everything else — just no reason to
    // send a list nothing renders.
    const [roster, anchors] = await Promise.all([
      listHousehold(db),
      canAdd ? listAnchors(db) : [],
    ]);

    return { roster, anchors, canAdd };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  const intent = String(form.get("intent") ?? "");
  if (intent === "invite" || intent === "link") {
    return signInAction(request, intent, form);
  }

  const relation = String(form.get("relation") ?? "");
  const anchorOwnerId = String(form.get("anchorOwnerId") ?? "");
  const parentType = String(form.get("parentType") ?? "biological") as ParentType;

  // "The root of the tree" is a real answer, not a missing one: the first person
  // in a household has nobody to attach to (`PRODUCT.md` §Screens).
  const link: PersonLink | null =
    relation === "root" || !anchorOwnerId
      ? null
      : relation === "spouse_of" || relation === "sibling_of"
        ? { relation, anchorOwnerId }
        : relation === "child_of" || relation === "parent_of"
          ? { relation, anchorOwnerId, parentType }
          : null;

  if (relation && relation !== "root" && !link) {
    return { error: "Pick how they are related." };
  }

  const bornOn = String(form.get("bornOn") ?? "").trim();
  const sexField = String(form.get("sex") ?? "");
  // Anything but the two values is "not recorded", rather than an error or a
  // cast failure in the database.
  const sex = SEXES.find((option) => option.value === sexField)?.value ?? null;

  try {
    const added = await withVault(request, async (db) => {
      const result = await addPerson(db, {
        givenName: String(form.get("givenName") ?? ""),
        familyName: String(form.get("familyName") ?? ""),
        bornOn: bornOn || null,
        sex,
        link,
      });

      // In the same transaction as the insert, so a log that cannot be written
      // takes the person with it (activity.server.ts).
      if (result.ok) {
        await record(db, {
          action: ACTIONS.personAdded,
          subjectType: "owner",
          subjectId: result.ownerId,
        });
      }

      return result;
    });

    return added.ok ? { added: true as const } : { error: added.problem };
  } catch (error) {
    // A refusal reads as a database error. Saying more than this would describe
    // a rule to somebody the rule exists to stop.
    if ((error as { cause?: { code?: string } })?.cause?.code === "42501") {
      return { error: "Only the household administrator can add a person." };
    }

    throw error;
  }
}

/**
 * Inviting somebody, or making a new sign-in link for them.
 *
 * Who may is decided in auth.server.ts, which checks the session for an active
 * admin before it asks any question at all. The vault transaction here does two
 * other jobs: it confirms the owner is a person this admin can see, through the
 * ordinary policies, and it writes the log line. The link is returned only
 * after that line is written, so a link nobody logged is a link nobody saw.
 */
async function signInAction(request: Request, intent: "invite" | "link", form: FormData) {
  const ownerId = String(form.get("ownerId") ?? "");

  try {
    return await withVault(request, async (db) => {
      const [person] = await db.execute<{ name: string }>(sql`
        select display_name as name from owners
        where id = ${ownerId} and kind = 'person' and archived_at is null
      `);
      if (!person) return { ownerId, error: "Pick somebody in the household." };

      const result =
        intent === "invite"
          ? await inviteToSignIn(request.headers, {
              personOwnerId: ownerId,
              email: String(form.get("email") ?? ""),
              name: person.name,
            })
          : await signInLinkFor(request.headers, ownerId);

      if (!result.ok) return { ownerId, error: result.problem };

      await record(db, {
        action: intent === "invite" ? ACTIONS.accountInvited : ACTIONS.signInLinkMade,
        subjectType: "owner",
        subjectId: ownerId,
      });

      return { ownerId, link: result.link };
    });
  } catch (error) {
    if (error instanceof NotAllowed) {
      return { ownerId, error: "Only the household administrator can do that." };
    }
    throw error;
  }
}

/** The link, once, with what to do with it. */
function SignInControls({
  row,
  result,
}: {
  row: { ownerId: string; displayName: string; hasAccount: boolean };
  result?: { link?: string; error?: string };
}) {
  if (result?.link) {
    return (
      <div className="mt-2 flex flex-col gap-1 text-xs">
        <input
          readOnly
          aria-label={`Sign-in link for ${row.displayName}`}
          className="rounded-lg border border-gray-300 p-2 font-mono"
          value={result.link}
          onFocus={(event) => event.currentTarget.select()}
        />
        <span className="text-gray-500">
          Give this to {row.displayName} yourself. It works once, for three days,
          and it is not shown again.
        </span>
      </div>
    );
  }

  return (
    <Form method="post" className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="ownerId" value={row.ownerId} />
      {row.hasAccount ? (
        <button className="underline" type="submit" name="intent" value="link">
          New sign-in link
        </button>
      ) : (
        <>
          <input
            className="rounded-lg border border-gray-300 p-1"
            type="email"
            name="email"
            placeholder="their email"
            aria-label={`Email for ${row.displayName}`}
            required
          />
          <button className="underline" type="submit" name="intent" value="invite">
            Invite
          </button>
        </>
      )}
      {result?.error ? <span className="text-red-700">{result.error}</span> : null}
    </Form>
  );
}

const KIND_LABELS: Record<string, string> = {
  person: "People",
  business: "Businesses",
  household: "The household",
};

export default function People({ loaderData, actionData }: Route.ComponentProps) {
  const { roster, anchors, canAdd } = loaderData;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const groups = ["person", "business", "household"].filter((kind) =>
    roster.some((row) => row.kind === kind),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">People</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everyone and everything documents can be filed to.
        </p>
      </div>

      {groups.map((kind) => (
        <section key={kind}>
          <h2 className="text-sm font-medium">{KIND_LABELS[kind]}</h2>
          <ul className="mt-2 rounded-lg border border-gray-200 text-sm">
            {roster
              .filter((row) => row.kind === kind)
              .map((row) => (
                <li
                  key={row.ownerId}
                  className="flex items-baseline justify-between gap-4 border-b border-gray-100 p-4 last:border-b-0"
                >
                  <span>
                    {row.displayName}
                    {row.diedOn ? (
                      <span className="text-gray-500"> · died {row.diedOn}</span>
                    ) : null}
                    {row.archived ? (
                      <span className="text-gray-500"> · archived</span>
                    ) : null}
                    {/* Presentation, like `canAdd`: auth.server.ts refuses anybody else. */}
                    {canAdd && kind === "person" && !row.archived && !row.diedOn ? (
                      <SignInControls
                        row={{ ...row, hasAccount: row.account !== null }}
                        result={
                          actionData && "ownerId" in actionData && actionData.ownerId === row.ownerId
                            ? actionData
                            : undefined
                        }
                      />
                    ) : null}
                  </span>
                  <span className="text-right text-xs text-gray-500">
                    {row.recordCount} {row.recordCount === 1 ? "record" : "records"}
                    <br />
                    {row.account
                      ? `${row.account.role}${row.account.disabled ? ", disabled" : ""}`
                      : "no sign-in"}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {canAdd ? (
        <section>
          <h2 className="text-sm font-medium">Add somebody</h2>

          {/*
            One sentence, in the order it is spoken: "___ is the ___ of ___."
            The relationship is the middle of it rather than a separate step,
            because every person added to a household is added *in relation to*
            somebody already there — except the first, who gets "the root".
          */}
          <Form method="post" className="mt-2 flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Given name</span>
                <input
                  className="rounded-lg border border-gray-300 p-2"
                  name="givenName"
                  required
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Family name</span>
                <input
                  className="rounded-lg border border-gray-300 p-2"
                  name="familyName"
                  required
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Born</span>
                <input
                  className="rounded-lg border border-gray-300 p-2"
                  type="date"
                  name="bornOn"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Sex</span>
                <select
                  className="rounded-lg border border-gray-300 p-2"
                  name="sex"
                  defaultValue=""
                >
                  <option value="">not recorded</option>
                  {SEXES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <span className="pb-2 text-gray-500">is the</span>

              <select
                className="rounded-lg border border-gray-300 p-2"
                name="relation"
                defaultValue={anchors.length === 0 ? "root" : "child_of"}
              >
                {anchors.length === 0 ? (
                  <option value="root">root of the tree</option>
                ) : (
                  RELATIONS.map((relation) => (
                    <option key={relation.value} value={relation.value}>
                      {relation.label}
                    </option>
                  ))
                )}
              </select>

              {anchors.length > 0 ? (
                <select
                  className="rounded-lg border border-gray-300 p-2"
                  name="anchorOwnerId"
                  required
                >
                  {anchors.map((anchor) => (
                    <option key={anchor.ownerId} value={anchor.ownerId}>
                      {anchor.displayName}
                    </option>
                  ))}
                </select>
              ) : null}

              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Parent type</span>
                <select
                  className="rounded-lg border border-gray-300 p-2"
                  name="parentType"
                  defaultValue="biological"
                >
                  {PARENT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {anchors.length === 0 ? (
              <p className="text-xs text-gray-500">
                There is nobody here yet, so this person is the root of the tree
                and attaches to nobody.
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Brothers and sisters are worked out from a shared parent rather
                than stored, so adding one copies the parents of the person you
                pick.
              </p>
            )}

            {actionData && !("ownerId" in actionData) && "error" in actionData && actionData.error ? (
              <p className="text-sm text-red-700">{actionData.error}</p>
            ) : null}

            {actionData && "added" in actionData ? (
              <p className="text-sm text-gray-500">Added.</p>
            ) : null}

            <button
              className="self-start rounded-lg bg-gray-900 p-2 px-3 text-sm text-white"
              type="submit"
              disabled={saving}
            >
              {saving ? "Adding…" : "Add to the household"}
            </button>
          </Form>

          <p className="mt-4 text-xs text-gray-500">
            Adding somebody here does not create a sign-in for them. A person and
            an account are different things, and the second is a separate step.
          </p>
        </section>
      ) : null}
    </main>
  );
}
