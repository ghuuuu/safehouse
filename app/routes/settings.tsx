import { data, Form, useNavigation } from "react-router";

import type { Route } from "./+types/settings";
import { auth, listDevices, MIN_PASSWORD, signOutDevice } from "../auth.server";
import { requireUser, withVault } from "../session.server";
import { roleLabel } from "../roles";
import { LIMITS } from "../settings";
import { readSettings, saveSettings } from "../settings.server";
import { deliveryStatus, message } from "../notify.server";
import { sql } from "drizzle-orm";
import { When } from "../when";
import { Masthead, Page } from "../masthead";

export function meta() {
  return [{ title: "Settings — Safehouse" }];
}

/**
 * How this surface enforces access.
 *
 * Everything under Account and Security is about the signed-in account only:
 * the library's endpoints act on the session that called them, and the device
 * list is read for the caller's own user id (`listDevices`). Session tokens and
 * password hashes never reach this page.
 *
 * The household's settings are read by anybody signed in and changed only by
 * an active admin — `settings_update` (0014) refuses anybody else, and the
 * form is drawn for admins only as presentation.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const session = await auth.api.getSession({ headers: request.headers });
  const twoFactorOn = Boolean((session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled);

  const { settings, delivery, notifications } = await withVault(request, async (db) => ({
    settings: await readSettings(db),
    delivery: user.role === "admin" ? await deliveryStatus(db) : null,
    // Your own, newest first: `notifications_read` is the recipient only. The
    // text shown is the same sentence that went out, so nothing here says more.
    notifications: [
      ...(await db.execute<{ id: string; kind: string; daysLeft: number | null; createdAt: string; deliveredAt: string | null; error: string | null }>(sql`
        select n.id, n.kind, (d.expires_on - current_date) as "daysLeft",
               n.created_at::text as "createdAt", n.delivered_at::text as "deliveredAt",
               n.delivery_error as error
        from notifications n
        left join documents d on n.kind = 'expiry.soon' and d.id = n.subject_id
        order by n.created_at desc
        limit 20
      `)),
    ].map((n) => ({ ...n, text: message(n.kind, n.daysLeft) })),
  }));
  const devices = (await listDevices(request.headers)).map((d) => ({
    ...d,
    signedInAt: d.signedInAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
  }));

  // Passed down rather than imported: the component cannot import a `.server` module.
  return { user, twoFactorOn, devices, settings, delivery, notifications, isAdmin: user.role === "admin", minPassword: MIN_PASSWORD };
}

/** Passes the library's cookies through, since some of these rotate the session. */
function withCookies<T>(value: T, response: Response) {
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return data(value, { headers });
}

type Result = {
  section: string;
  ok?: string;
  error?: string;
  setup?: { secret: string; backupCodes: string[] };
};

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const headers = request.headers;
  const field = (name: string) => String(form.get(name) ?? "");

  if (intent === "password") {
    if (field("newPassword").length < MIN_PASSWORD) {
      return { section: "password", error: `Use at least ${MIN_PASSWORD} characters.` } satisfies Result;
    }
    const response = await auth.api.changePassword({
      body: { currentPassword: field("currentPassword"), newPassword: field("newPassword"), revokeOtherSessions: true },
      headers,
      asResponse: true,
    });
    return response.ok
      ? withCookies<Result>({ section: "password", ok: "Changed. Every other device has been signed out." }, response)
      : ({ section: "password", error: "That is not your current password." } satisfies Result);
  }

  if (intent === "2fa-start") {
    const response = await auth.api.enableTwoFactor({ body: { password: field("password") }, headers, asResponse: true });
    if (!response.ok) return { section: "2fa", error: "That is not your password." } satisfies Result;
    const body = (await response.clone().json()) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(body.totpURI).searchParams.get("secret") ?? "";
    return withCookies<Result>({ section: "2fa", setup: { secret, backupCodes: body.backupCodes } }, response);
  }

  if (intent === "2fa-confirm") {
    const response = await auth.api.verifyTOTP({
      body: { code: field("code").replace(/\s+/g, "") },
      headers,
      asResponse: true,
    });
    return response.ok
      ? withCookies<Result>({ section: "2fa", ok: "Two-factor is on. Signing in now asks for a code." }, response)
      : ({ section: "2fa", error: "That code did not work. Start again, and type the code your app shows now." } satisfies Result);
  }

  if (intent === "2fa-off") {
    const response = await auth.api.disableTwoFactor({ body: { password: field("password") }, headers, asResponse: true });
    return response.ok
      ? withCookies<Result>({ section: "2fa", ok: "Two-factor is off." }, response)
      : ({ section: "2fa", error: "That is not your password." } satisfies Result);
  }

  if (intent === "device-out") {
    const done = await signOutDevice(headers, field("sessionId"));
    return { section: "devices", ...(done ? { ok: "Signed out." } : { error: "That device is already signed out." }) } satisfies Result;
  }

  if (intent === "others-out") {
    await auth.api.revokeOtherSessions({ headers });
    return { section: "devices", ok: "Every other device has been signed out." } satisfies Result;
  }

  if (intent === "household") {
    const number = (name: string) => Number.parseInt(field(name), 10);
    const result = await withVault(request, (db) =>
      saveSettings(db, {
        expiryReminderLeadDays: number("expiryReminderLeadDays"),
        emergencyWindowHours: number("emergencyWindowHours"),
        autoLockMinutes: number("autoLockMinutes"),
      }),
    );
    return { section: "household", ...(result.ok ? { ok: "Saved." } : { error: result.problem }) } satisfies Result;
  }

  return { section: "", error: "Nothing to do." } satisfies Result;
}

const panel = "sheet flex flex-col gap-4 p-5 md:p-6";
const panelHead = "border-b border-gray-900 pb-2 text-lg font-semibold";
/** A part of a panel, ruled off from the part above it. */
const part = "flex flex-col gap-3 border-t border-gray-200 pt-4";
const input = "field";
const numberInput = "field max-w-40 font-mono font-normal";
/** The most recent devices are shown; the rest wait behind "Show all". */
const RECENT_DEVICES = 5;

/** A stored message starts mid-sentence after its prefix; on screen it starts a sentence. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const button = "btn btn-secondary self-start";
const deviceRow = "flex items-center justify-between gap-4 border-b border-gray-200 py-3 last:border-b-0";
const deviceOut = "btn btn-secondary btn-sm";

function Note({ result, section }: { result: Result | undefined; section: string }) {
  if (!result || result.section !== section) return null;
  if (result.error) return <p role="alert" className="text-sm text-red-700 dark:text-red-400">{result.error}</p>;
  if (result.ok) return <p className="text-sm text-gray-600">{result.ok}</p>;
  return null;
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { user, twoFactorOn, devices, settings, delivery, notifications, isAdmin, minPassword } = loaderData;
  const result = actionData as Result | undefined;
  const busy = useNavigation().state !== "idle";
  const setup = result?.section === "2fa" ? result.setup : undefined;

  return (
    <>
    <Masthead title="Settings" serial={<>{user.name} · {roleLabel(user.role)}</>} />
    <Page narrow>
      <section className={panel}>
        <h2 className={panelHead}>Account</h2>
        <dl className="grid grid-cols-[6rem_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
          <dt className="index text-gray-500">Name</dt><dd className="min-w-0 break-words">{user.name}</dd>
          <dt className="index text-gray-500">Email</dt><dd className="min-w-0 break-words">{user.email}</dd>
          <dt className="index text-gray-500">Role</dt><dd>{roleLabel(user.role)}</dd>
        </dl>

        <Form method="post" className="flex flex-col gap-3 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold">Change your password</h3>
          <input type="hidden" name="intent" value="password" />
          <input className={input} type="password" name="currentPassword" autoComplete="current-password" placeholder="Current password" aria-label="Current password" required />
          <input className={input} type="password" name="newPassword" autoComplete="new-password" minLength={minPassword} placeholder={`New password, at least ${minPassword} characters`} aria-label="New password" required />
          <Note result={result} section="password" />
          <button className={button} type="submit" disabled={busy}>Change password</button>
        </Form>
      </section>

      <section className={panel}>
        <h2 className={panelHead}>Security</h2>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Two-factor sign-in</h3>
          {setup ? (
            <Form method="post" className="flex flex-col gap-3 text-sm">
              <p>
                In your authenticator app, add an account by typing this key. Then type the six digits it shows.
              </p>
              <code className="break-all rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-base tracking-wider">{setup.secret}</code>
              <p>
                Keep these backup codes somewhere safe and offline. Each one signs you in once if you lose your phone,
                and they are not shown again:
              </p>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-gray-200 bg-gray-50 p-3 font-mono tracking-wider sm:grid-cols-3">
                {setup.backupCodes.map((code) => <li key={code}>{code}</li>)}
              </ul>
              <input type="hidden" name="intent" value="2fa-confirm" />
              <input className={input} name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="Six-digit code" aria-label="Code from your app" required />
              <button className={button} type="submit" disabled={busy}>Turn it on</button>
            </Form>
          ) : twoFactorOn ? (
            <Form method="post" className="flex flex-col gap-3 text-sm">
              <p>On. Signing in asks for a code from your authenticator app.</p>
              <input type="hidden" name="intent" value="2fa-off" />
              <input className={input} type="password" name="password" autoComplete="current-password" placeholder="Your password, to turn it off" aria-label="Password" required />
              <button className={button} type="submit" disabled={busy}>Turn it off</button>
            </Form>
          ) : (
            <Form method="post" className="flex flex-col gap-3 text-sm">
              <p>Off. With it on, a stolen password is not enough to get in.</p>
              <input type="hidden" name="intent" value="2fa-start" />
              <input className={input} type="password" name="password" autoComplete="current-password" placeholder="Your password, to start" aria-label="Password" required />
              <button className={button} type="submit" disabled={busy}>Set it up</button>
            </Form>
          )}
          <Note result={result} section="2fa" />
        </div>

        <div className={part}>
          <h3 className="text-sm font-semibold">Signed-in devices</h3>
          <ul className="flex flex-col border-y border-gray-200 text-sm">
            {devices.slice(0, RECENT_DEVICES).map((device) => (
              <li key={device.id} className={deviceRow}>
                <span className="min-w-0">
                  <span className="font-medium">{device.device}</span>
                  {device.current ? <span className="text-gray-500"> · this one</span> : null}
                  <span className="block text-xs text-gray-500">
                    {device.ipAddress ? <span className="font-mono">{device.ipAddress} · </span> : ""}
                    last seen <span className="font-mono"><When at={device.lastSeenAt} /></span>
                  </span>
                </span>
                {device.current ? null : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="device-out" />
                    <input type="hidden" name="sessionId" value={device.id} />
                    <button className={deviceOut} type="submit" disabled={busy}>sign out</button>
                  </Form>
                )}
              </li>
            ))}
          </ul>
          {devices.length > RECENT_DEVICES ? (
            <details className="text-sm">
              <summary className="cursor-pointer py-1 text-gray-600 underline">
                Show all <span className="font-mono">{devices.length}</span>
              </summary>
              <ul className="mt-1 flex flex-col border-b border-gray-200">
                {devices.slice(RECENT_DEVICES).map((device) => (
                  <li key={device.id} className={deviceRow}>
                    <span className="min-w-0">
                      <span className="font-medium">{device.device}</span>
                      <span className="block text-xs text-gray-500">
                        {device.ipAddress ? <span className="font-mono">{device.ipAddress} · </span> : ""}
                        last seen <span className="font-mono"><When at={device.lastSeenAt} /></span>
                      </span>
                    </span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="device-out" />
                      <input type="hidden" name="sessionId" value={device.id} />
                      <button className={deviceOut} type="submit" disabled={busy}>sign out</button>
                    </Form>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {devices.length > 1 ? (
            <Form method="post">
              <input type="hidden" name="intent" value="others-out" />
              <button className={button} type="submit" disabled={busy}>Sign out everywhere else</button>
            </Form>
          ) : null}
          <Note result={result} section="devices" />
        </div>

        {settings ? (
          <p className="border-t border-gray-200 pt-4 text-sm text-gray-500 max-w-prose">
            Auto-lock: a page left alone for <span className="font-mono">{settings.autoLockMinutes}</span> minutes signs itself out.
          </p>
        ) : null}
      </section>

      <section id="notifications" className={panel}>
        <h2 className={panelHead}>Notifications</h2>
        {delivery ? (
          <p className="text-sm">
            {delivery.channel
              ? "Sent to your phone through the webhook this server was given."
              : "Nothing is sent outside the app: no channel is configured. Set SAFEHOUSE_NOTIFY_WEBHOOK (an ntfy topic, a Telegram bot, any URL that takes a POST) and restart."}{" "}
            {delivery.lastSweepAt ? <>Last checked <When at={delivery.lastSweepAt} />.</> : null}
          </p>
        ) : (
          <p className="text-sm text-gray-500 max-w-prose">What is running out is on your dashboard. Messages outside the app go to the administrator.</p>
        )}
        {notifications.length > 0 ? (
          <ul className="flex flex-col border-y border-gray-200 text-sm">
            {notifications.map((n) => (
              <li key={n.id} className="flex flex-col gap-1 border-b border-gray-200 py-3 last:border-b-0">
                <span>{sentence(n.text.replace(/^Safehouse: /, ""))}</span>
                <span className="text-xs text-gray-500">
                  <span className="font-mono"><When at={n.createdAt} /></span> ·{" "}
                  {n.deliveredAt ? "sent" : n.error ? <span className="text-red-700 dark:text-red-400">not sent: {n.error}</span> : "in the app only"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-gray-500 max-w-prose">
          A message never names a document, a person or a number. It says to open Safehouse.
        </p>
      </section>

      {settings ? (
        <section className={panel}>
          <h2 className={panelHead}>Household</h2>
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="household" />
            <fieldset disabled={!isAdmin || busy} className="flex flex-col gap-4 text-sm">
              <label className="flex flex-col gap-1 font-medium">
                Warn this many days before a document expires
                <input className={numberInput} type="number" name="expiryReminderLeadDays" defaultValue={settings.expiryReminderLeadDays} min={LIMITS.expiryReminderLeadDays.min} max={LIMITS.expiryReminderLeadDays.max} required />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                An emergency window lasts this many hours
                <input className={numberInput} type="number" name="emergencyWindowHours" defaultValue={settings.emergencyWindowHours} min={LIMITS.emergencyWindowHours.min} max={LIMITS.emergencyWindowHours.max} required />
                <span className="text-xs font-normal text-gray-500">
                  At most {LIMITS.emergencyWindowHours.max}. That ceiling is fixed in the code, not a setting.
                </span>
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Auto-lock after this many idle minutes
                <input className={numberInput} type="number" name="autoLockMinutes" defaultValue={settings.autoLockMinutes} min={LIMITS.autoLockMinutes.min} max={LIMITS.autoLockMinutes.max} required />
              </label>
              {isAdmin ? (
                <button className={button} type="submit">Save</button>
              ) : (
                <p className="text-gray-500">Only the household administrator can change these.</p>
              )}
            </fieldset>
            <Note result={result} section="household" />
          </Form>
        </section>
      ) : null}
    </Page>
    </>
  );
}
