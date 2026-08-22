import "dotenv/config";

/**
 * Read a required setting, failing immediately and by name if it is absent.
 *
 * Nobody reviews changes to this codebase, so a missing setting must stop the
 * server at boot with a message that says what is missing — never surface later
 * as an unexplained failure in the middle of a request.
 */
export function requireEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }

  return value;
}
