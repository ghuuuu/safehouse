import { PassThrough } from "node:stream";

import type { EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";

import { startSweeper } from "./notify.server";
import { checkKeyAtBoot } from "./key-check.server";
import { checkStoreAtBoot } from "./storage.server";

// React Router's default server entry, with this line added and the unused
// load-context parameter dropped to satisfy lint. The server
// imports this module when it starts, so a throw here means it never starts:
// no key file, or a key that opens none of the vault, stops it by name (D31).
await checkKeyAtBoot();
// And a document store it cannot write stops it too (D38).
await checkStoreAtBoot();

// Expiry reminders and break-glass alerts beyond the app (D37): now, and every
// 15 minutes. Not in tests, which call the sweep themselves.
if (process.env.NODE_ENV !== "test") startSweeper();

export const streamTimeout = 5_000;

/**
 * What the server log gets when a loader or action throws, in place of React
 * Router's default `console.error(error)`: the kind of error, the database's
 * code, the path and where in the code. Never the message, because a failed
 * query's message carries its parameters, and those are record field values
 * (CLAUDE.md: never logged).
 */
export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted) return;
  const failed = error as { name?: string; stack?: string; cause?: { code?: string } } | null;
  const code = failed?.cause?.code ? ` (database ${failed.cause.code})` : "";
  const where = failed?.stack?.split("\n").slice(1, 6).join("\n") ?? "";
  console.error(`${failed?.name ?? "Error"}${code} on ${request.method} ${new URL(request.url).pathname}\n${where}`);
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              // Clear the timeout to prevent retaining the closure and memory leak
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          // No page of the vault may be framed by another site (clickjacking
          // a Reveal or a Save), sniffed as something else, or named in a
          // Referer sent elsewhere. Not a full script policy: that needs the
          // framework's inline scripts nonced first, and is listed as work.
          responseHeaders.set("Content-Security-Policy", "frame-ancestors 'none'");
          responseHeaders.set("X-Frame-Options", "DENY");
          responseHeaders.set("X-Content-Type-Options", "nosniff");
          responseHeaders.set("Referrer-Policy", "same-origin");

          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
  });
}
