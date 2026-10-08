/**
 * The household's settings: their limits, shared by the form and the server.
 *
 * Not `.server`, because the settings page renders the limits. Each one is
 * also a check constraint in `0014_settings_and_two_factor.sql`, and
 * `settings.test.ts` keeps the emergency ceiling equal in both places.
 */

/**
 * The longest a break-glass window can ever be (D19). A constant, not a
 * setting: "a setting that can be raised without limit is not a ceiling".
 */
export const EMERGENCY_CEILING_HOURS = 72;

export const LIMITS = {
  expiryReminderLeadDays: { min: 1, max: 365 },
  emergencyWindowHours: { min: 1, max: EMERGENCY_CEILING_HOURS },
  autoLockMinutes: { min: 5, max: 240 },
} as const;

export type HouseholdSettings = {
  expiryReminderLeadDays: number;
  emergencyWindowHours: number;
  autoLockMinutes: number;
};
