/**
 * The production server (D44): what `react-router-serve` did, less its log.
 *
 * Its request log was morgan's "tiny" format, which writes the whole URL, so
 * `/search?q=<a passport number>` reached the container log in the clear
 * (CLAUDE.md: never log record field values). This one writes the path, the
 * status and the time, and never a query string.
 *
 * The same pieces `react-router-serve` is made of — Express, compression and
 * React Router's Express adapter — and nothing else.
 */

// As `react-router-serve` did, and before anything loads — imported React reads
// it once, and so does the sweeper, which runs only in production.
// Hence the imports below are dynamic: a static one would run before this line.
process.env.NODE_ENV ??= "production";

const { createRequestHandler } = await import("@react-router/express");
const { default: compression } = await import("compression");
const { default: express } = await import("express");
const build = await import("./build/server/index.js");
const port = Number(process.env.PORT ?? 3000);

const app = express();
app.disable("x-powered-by");
app.use(compression());

// Fingerprinted, so forever; everything else in the client build for an hour.
app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
app.use(express.static("build/client", { maxAge: "1h" }));

// After the files above, so only pages and actions are logged, as before.
app.use((req, res, next) => {
  const start = performance.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} - ${(performance.now() - start).toFixed(1)} ms`);
  });
  next();
});

// An action reads its whole body before it can look at anything else, and
// most take a few fields. Only the routes that take files get room for them,
// and those check who is asking before they read it.
// With JavaScript on, React Router posts a form to the same path plus ".data".
const TAKES_FILES = /^\/(upload|bulk\/file|intake\/[^/]+?)(\.data)?$/;
const FIELDS_LIMIT = 1024 * 1024;
// ponytail: bodies are buffered whole; stream uploads if this ever has to rise.
const FILES_LIMIT = 256 * 1024 * 1024;

app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  // Without a length, a body cannot be refused until it has been read.
  if (req.headers["transfer-encoding"]) return res.status(411).end();
  const limit = TAKES_FILES.test(req.path) ? FILES_LIMIT : FIELDS_LIMIT;
  if (Number(req.headers["content-length"] ?? 0) > limit) {
    return res.status(413).type("text").send("That is more than the vault takes in one go.");
  }
  next();
});

app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV }));

const server = app.listen(port, () =>
  console.log(`SafeHouse ${process.env.npm_package_version ?? ""} on http://localhost:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
