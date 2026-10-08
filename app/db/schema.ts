/**
 * Safehouse schema.
 *
 * Shape and reasoning: DECISIONS.md D15 (owners, people and users are three
 * different things), D16 (typed and dated tree edges), D17 (private records),
 * D18 (third-party grants as two lists), D19 (emergency expiry), D20 (records
 * hold dated documents; documents hold pages).
 *
 * The permission views and row-level security policies that make D11 true are
 * not here. They are hand-written SQL in drizzle/, because a permission rule
 * should be readable on its own.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const ownerKind = pgEnum("owner_kind", [
  "person",
  "business",
  "household",
]);

export const userRole = pgEnum("user_role", [
  "admin",
  "individual",
  "third_party",
  "emergency",
]);

export const relationshipKind = pgEnum("relationship_kind", [
  "parent_of",
  "spouse_of",
]);

export const parentType = pgEnum("parent_type", [
  "biological",
  "adoptive",
  "step",
  "guardian",
]);

/** What the tree draws (D33). Nullable on `people`: "not recorded" is a real answer. */
export const personSex = pgEnum("person_sex", ["female", "male"]);

export const category = pgEnum("category", [
  "personal",
  "medical",
  "business",
  "financial",
  "legal",
  "general",
]);

/** Everything a document can be filed to (D15). */
export const owners = pgTable("owners", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: ownerKind("kind").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const people = pgTable("people", {
  ownerId: uuid("owner_id")
    .primaryKey()
    .references(() => owners.id, { onDelete: "restrict" }),
  givenName: text("given_name").notNull(),
  familyName: text("family_name").notNull(),
  bornOn: date("born_on"),
  diedOn: date("died_on"),
  sex: personSex("sex"),
});

export const businesses = pgTable("businesses", {
  ownerId: uuid("owner_id")
    .primaryKey()
    .references(() => owners.id, { onDelete: "restrict" }),
  legalName: text("legal_name").notNull(),
  formedOn: date("formed_on"),
});

/**
 * Everything that can sign in. Not every user is a person (D15).
 *
 * This is also the auth library's `user` model — one identity, one row, rather
 * than two tables that can disagree about who exists. The library owns `email`,
 * `emailVerified`, `name`, `image` and the timestamps; Safehouse owns `role`,
 * `personOwnerId` and `disabledAt`, and the library is configured not to accept
 * those from a request (D24).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  /** Required by the auth library. Unused: a vault has no need of avatars. */
  image: text("image"),
  role: userRole("role").notNull().default("individual"),
  personOwnerId: uuid("person_owner_id").references(() => owners.id, {
    onDelete: "restrict",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  /** Owned by the auth library's two-factor plugin (0014). */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
});

/**
 * Sessions live in Postgres, not in a signed cookie (D10). Signing somebody out
 * has to mean it: deleting the row ends the session on the next request, which
 * a self-contained cookie could not promise.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Credentials. The password hash lives here, and only the auth role can read it. */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("accounts_issuer_account_unique").on(t.issuer, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

/**
 * Two-factor secrets and backup codes (0014). A credential: the auth role
 * only, and the library encrypts the secret before writing it.
 */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factors_user_idx").on(t.userId)],
);

/** Short-lived tokens: email verification, password reset. */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/**
 * Tree edges. `parent_of` runs from parent to child; `spouse_of` is symmetric
 * and stored once. Siblings are derived from a shared parent, never stored, so
 * the two can never contradict each other (D16).
 */
export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromOwnerId: uuid("from_owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    toOwnerId: uuid("to_owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    kind: relationshipKind("kind").notNull(),
    parentType: parentType("parent_type"),
    startedOn: date("started_on"),
    endedOn: date("ended_on"),
  },
  (t) => [
    check("relationship_not_self", sql`${t.fromOwnerId} <> ${t.toOwnerId}`),
    check(
      "parent_type_matches_kind",
      sql`(${t.kind} = 'parent_of' and ${t.parentType} is not null) or (${t.kind} = 'spouse_of' and ${t.parentType} is null)`,
    ),
    uniqueIndex("relationships_active_unique")
      .on(t.fromOwnerId, t.toOwnerId, t.kind)
      .where(sql`ended_on is null`),
    index("relationships_to_idx").on(t.toOwnerId, t.kind),
  ],
);

export const subcategories = pgTable(
  "subcategories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: category("category").notNull(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
  },
  (t) => [unique("subcategories_slug_unique").on(t.category, t.slug)],
);

/** The card in the vault (D20). Private records are D17. */
export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    category: category("category").notNull(),
    subcategoryId: uuid("subcategory_id").references(() => subcategories.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("records_owner_idx").on(t.ownerId, t.category)],
);

/** One dated version of a record, with the fields that drive features (D20). */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    documentDate: date("document_date"),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),
    issuerCountry: text("issuer_country"),
    /**
     * Empty, and held there by `identifier_is_sealed` (0013). Kept only until
     * every deployment has run `identifiers:seal`; read nothing from it.
     */
    identifier: text("identifier"),
    /** The number, sealed (D35). Opened only by a logged reveal. */
    identifierSealed: bytea("identifier_sealed"),
    /** Keyed fingerprints for search: the whole number, and its last four. */
    identifierFp: bytea("identifier_fp"),
    identifierLast4Fp: bytea("identifier_last4_fp"),
    placeOfIssue: text("place_of_issue"),
    originalLocationNote: text("original_location_note"),
    details: jsonb("details").notNull().default({}),
    /**
     * Which fields a person has looked at and agreed with (D26).
     *
     * Extraction proposes values; a human confirms them. Anything not named
     * here was never confirmed by anybody, and nothing — an expiry reminder
     * least of all — is allowed to act on it.
     */
    confirmedFields: jsonb("confirmed_fields").notNull().default([]),
    /** The reader's working notes (D26, D28). Never authoritative. */
    extraction: jsonb("extraction").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("documents_version_unique").on(t.recordId, t.versionNo),
    uniqueIndex("documents_one_current")
      .on(t.recordId)
      .where(sql`is_current`),
    index("documents_expiry_idx").on(t.expiresOn),
  ],
);

/** One page of a scan. Encryption is a property of the file (D12). */
export const documentFiles = pgTable(
  "document_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNo: integer("page_no").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    mime: text("mime").notNull(),
    wrappedDek: bytea("wrapped_dek").notNull(),
    nonce: bytea("nonce").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("document_files_page_unique").on(t.documentId, t.pageNo)],
);

/** Third-party grants: whose papers (D18). */
export const grantOwners = pgTable(
  "grant_owners",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ownerId] })],
);

/** Third-party grants: which kinds (D18). */
export const grantCategories = pgTable(
  "grant_categories",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: category("category").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] })],
);

/** The per-record exception a private record requires (D17, D18). */
export const grantRecords = pgTable(
  "grant_records",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.recordId] })],
);

/** Break-glass. Each activation carries its own expiry (D19). */
export const emergencyActivations = pgTable(
  "emergency_activations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    reason: text("reason"),
  },
  (t) => [index("emergency_active_idx").on(t.userId, t.expiresAt)],
);

export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    emergencyWindowHours: integer("emergency_window_hours")
      .notNull()
      .default(24),
    expiryReminderLeadDays: integer("expiry_reminder_lead_days")
      .notNull()
      .default(60),
    /** An idle page signs itself out after this long (0014). */
    autoLockMinutes: integer("auto_lock_minutes").notNull().default(15),
  },
  (t) => [check("settings_singleton", sql`${t.id} = 1`)],
);

/** Ids only. Never field values, never file names (CLAUDE.md). */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actingAsUserId: uuid("acting_as_user_id").references(() => users.id),
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    /** What a grant line granted (0012). Typed, so it can never hold a value. */
    targetId: uuid("target_id"),
    targetCategory: category("target_category"),
  },
  (t) => [index("activity_at_idx").on(t.at)],
);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
  /** Delivery outside the app (0015). The error is a status, never a body. */
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  deliveryError: text("delivery_error"),
  deliveredChannels: text("delivered_channels").array().notNull().default([]),
});
