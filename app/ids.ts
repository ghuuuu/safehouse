/**
 * Whether a string from a URL can be an id at all. Asked before it reaches a
 * `uuid` column, where anything else is a cast error and a 500 instead of the
 * plain "not found" it is.
 */
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
