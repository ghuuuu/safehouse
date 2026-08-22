/**
 * The household the permission tests reason about.
 *
 * Entirely fictional, and deliberately awkward: a divorce, a step-child, a
 * guardianship that ended, a death, a private counselling letter and a private
 * will. A tidy family proves nothing — every rule worth testing is a rule about
 * the untidy case.
 *
 * No real names, numbers or addresses. See CLAUDE.md.
 */

import type { Sql } from "postgres";

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Owners: people, the business, and the household itself (D15). */
export const OWNER = {
  rose: id(1),
  frank: id(2),
  maya: id(3),
  daniel: id(4),
  ivy: id(5),
  theo: id(6),
  nadia: id(7),
  omar: id(8),
  lena: id(9),
  bram: id(10),
  priya: id(11),
  household: id(20),
  hale: id(21),
} as const;

export const USER = {
  /** Household admin. Deliberately outside the tree, to keep role and kin apart. */
  priya: id(100),
  maya: id(101),
  daniel: id(102),
  ivy: id(103),
  rose: id(104),
  /** Third party: the business accountant. */
  sam: id(105),
  /** Individual whose account has been disabled. */
  tenant: id(106),
  /** Emergency contact with a live window. */
  medic: id(107),
  /** Emergency contact whose window ran out. */
  lapsed: id(108),
  /** Emergency contact whose window the admin revoked. */
  pulled: id(109),
} as const;

export const RECORD = {
  mayaPassport: id(200),
  danielLicence: id(201),
  ivyImmunisation: id(202),
  ivyCounselling: id(203),
  roseWill: id(204),
  householdDeed: id(205),
  halePermit: id(206),
  haleTaxReturn: id(207),
  theoPassport: id(208),
  nadiaPassport: id(209),
  lenaCarePlan: id(210),
} as const;

export const DOCUMENT = {
  mayaPassport: id(300),
  danielLicenceOld: id(301),
  danielLicence: id(302),
  ivyImmunisation: id(303),
  ivyCounselling: id(304),
  roseWill: id(305),
  householdDeed: id(306),
  halePermit: id(307),
  haleTaxReturn: id(308),
  theoPassport: id(309),
  nadiaPassport: id(310),
  lenaCarePlan: id(311),
} as const;

export const FILE = {
  mayaPassport: id(400),
  ivyCounselling: id(401),
  roseWill: id(402),
} as const;

export async function insertFixture(sql: Sql): Promise<void> {
  await sql`
    insert into owners (id, kind, display_name) values
      (${OWNER.rose}, 'person', 'Rose Adeyemi'),
      (${OWNER.frank}, 'person', 'Frank Adeyemi'),
      (${OWNER.maya}, 'person', 'Maya Adeyemi'),
      (${OWNER.daniel}, 'person', 'Daniel Hale'),
      (${OWNER.ivy}, 'person', 'Ivy Hale'),
      (${OWNER.theo}, 'person', 'Theo Hale'),
      (${OWNER.nadia}, 'person', 'Nadia Brandt'),
      (${OWNER.omar}, 'person', 'Omar Brandt'),
      (${OWNER.lena}, 'person', 'Lena Okonjo'),
      (${OWNER.bram}, 'person', 'Bram Okonjo'),
      (${OWNER.priya}, 'person', 'Priya Raman'),
      (${OWNER.household}, 'household', 'The Hale household'),
      (${OWNER.hale}, 'business', 'Hale Consulting LLC')
  `;

  await sql`
    insert into people (owner_id, given_name, family_name, born_on, died_on) values
      (${OWNER.rose}, 'Rose', 'Adeyemi', '1951-03-04', null),
      (${OWNER.frank}, 'Frank', 'Adeyemi', '1949-11-19', '2021-06-02'),
      (${OWNER.maya}, 'Maya', 'Adeyemi', '1979-07-22', null),
      (${OWNER.daniel}, 'Daniel', 'Hale', '1977-01-30', null),
      (${OWNER.ivy}, 'Ivy', 'Hale', '2004-09-14', null),
      (${OWNER.theo}, 'Theo', 'Hale', '2001-04-08', null),
      (${OWNER.nadia}, 'Nadia', 'Brandt', '1978-02-11', null),
      (${OWNER.omar}, 'Omar', 'Brandt', '1950-08-30', null),
      (${OWNER.lena}, 'Lena', 'Okonjo', '2011-12-01', null),
      (${OWNER.bram}, 'Bram', 'Okonjo', '2003-05-17', null),
      (${OWNER.priya}, 'Priya', 'Raman', '1968-10-06', null)
  `;

  await sql`
    insert into businesses (owner_id, legal_name, formed_on) values
      (${OWNER.hale}, 'Hale Consulting LLC', '2015-02-01')
  `;

  await sql`
    insert into users (id, email, name, role, person_owner_id, disabled_at) values
      (${USER.priya}, 'priya@example.invalid', 'Priya Raman', 'admin', ${OWNER.priya}, null),
      (${USER.maya}, 'maya@example.invalid', 'Maya Adeyemi', 'individual', ${OWNER.maya}, null),
      (${USER.daniel}, 'daniel@example.invalid', 'Daniel Hale', 'individual', ${OWNER.daniel}, null),
      (${USER.ivy}, 'ivy@example.invalid', 'Ivy Hale', 'individual', ${OWNER.ivy}, null),
      (${USER.rose}, 'rose@example.invalid', 'Rose Adeyemi', 'individual', ${OWNER.rose}, null),
      (${USER.sam}, 'sam@example.invalid', 'Sam Okafor', 'third_party', null, null),
      (${USER.tenant}, 'tenant@example.invalid', 'Former Lodger', 'individual', null, now()),
      (${USER.medic}, 'medic@example.invalid', 'Emergency Contact', 'emergency', null, null),
      (${USER.lapsed}, 'lapsed@example.invalid', 'Lapsed Contact', 'emergency', null, null),
      (${USER.pulled}, 'pulled@example.invalid', 'Revoked Contact', 'emergency', null, null)
  `;

  // parent_of runs from parent to child; spouse_of is stored once (D16).
  await sql`
    insert into relationships (from_owner_id, to_owner_id, kind, parent_type, started_on, ended_on) values
      (${OWNER.rose}, ${OWNER.frank}, 'spouse_of', null, '1974-05-11', null),
      (${OWNER.daniel}, ${OWNER.maya}, 'spouse_of', null, '2012-08-18', null),
      (${OWNER.daniel}, ${OWNER.nadia}, 'spouse_of', null, '1999-06-05', '2010-03-22'),
      (${OWNER.rose}, ${OWNER.maya}, 'parent_of', 'biological', '1979-07-22', null),
      (${OWNER.frank}, ${OWNER.maya}, 'parent_of', 'biological', '1979-07-22', null),
      (${OWNER.omar}, ${OWNER.nadia}, 'parent_of', 'biological', '1978-02-11', null),
      (${OWNER.maya}, ${OWNER.ivy}, 'parent_of', 'biological', '2004-09-14', null),
      (${OWNER.daniel}, ${OWNER.ivy}, 'parent_of', 'biological', '2004-09-14', null),
      (${OWNER.daniel}, ${OWNER.theo}, 'parent_of', 'biological', '2001-04-08', null),
      (${OWNER.nadia}, ${OWNER.theo}, 'parent_of', 'biological', '2001-04-08', null),
      (${OWNER.maya}, ${OWNER.theo}, 'parent_of', 'step', '2012-08-18', null),
      (${OWNER.rose}, ${OWNER.lena}, 'parent_of', 'guardian', '2020-01-15', null),
      (${OWNER.rose}, ${OWNER.bram}, 'parent_of', 'guardian', '2015-04-02', '2021-05-17')
  `;

  await sql`
    insert into records (id, owner_id, category, kind, title, is_private) values
      (${RECORD.mayaPassport}, ${OWNER.maya}, 'personal', 'passport', 'Passport', false),
      (${RECORD.danielLicence}, ${OWNER.daniel}, 'personal', 'driving_licence', 'Driving licence', false),
      (${RECORD.ivyImmunisation}, ${OWNER.ivy}, 'medical', 'immunisation', 'Immunisation record', false),
      (${RECORD.ivyCounselling}, ${OWNER.ivy}, 'medical', 'letter', 'Counselling letter', true),
      (${RECORD.roseWill}, ${OWNER.rose}, 'legal', 'will', 'Last will', true),
      (${RECORD.householdDeed}, ${OWNER.household}, 'legal', 'deed', 'House deed', false),
      (${RECORD.halePermit}, ${OWNER.hale}, 'business', 'permit', 'Trading permit', false),
      (${RECORD.haleTaxReturn}, ${OWNER.hale}, 'financial', 'tax_return', 'Tax return', false),
      (${RECORD.theoPassport}, ${OWNER.theo}, 'personal', 'passport', 'Passport', false),
      (${RECORD.nadiaPassport}, ${OWNER.nadia}, 'personal', 'passport', 'Passport', false),
      (${RECORD.lenaCarePlan}, ${OWNER.lena}, 'medical', 'care_plan', 'Care plan', false)
  `;

  await sql`
    insert into documents (id, record_id, version_no, is_current, identifier, expires_on) values
      (${DOCUMENT.mayaPassport}, ${RECORD.mayaPassport}, 1, true, 'FIXTURE-PP-0001', '2029-01-31'),
      (${DOCUMENT.danielLicenceOld}, ${RECORD.danielLicence}, 1, false, 'FIXTURE-DL-0001', '2024-05-05'),
      (${DOCUMENT.danielLicence}, ${RECORD.danielLicence}, 2, true, 'FIXTURE-DL-0002', '2034-05-05'),
      (${DOCUMENT.ivyImmunisation}, ${RECORD.ivyImmunisation}, 1, true, null, null),
      (${DOCUMENT.ivyCounselling}, ${RECORD.ivyCounselling}, 1, true, null, null),
      (${DOCUMENT.roseWill}, ${RECORD.roseWill}, 1, true, null, null),
      (${DOCUMENT.householdDeed}, ${RECORD.householdDeed}, 1, true, 'FIXTURE-DEED-0001', null),
      (${DOCUMENT.halePermit}, ${RECORD.halePermit}, 1, true, 'FIXTURE-PERMIT-0001', '2026-10-01'),
      (${DOCUMENT.haleTaxReturn}, ${RECORD.haleTaxReturn}, 1, true, null, null),
      (${DOCUMENT.theoPassport}, ${RECORD.theoPassport}, 1, true, 'FIXTURE-PP-0002', '2031-03-19'),
      (${DOCUMENT.nadiaPassport}, ${RECORD.nadiaPassport}, 1, true, 'FIXTURE-PP-0003', '2030-07-07'),
      (${DOCUMENT.lenaCarePlan}, ${RECORD.lenaCarePlan}, 1, true, null, null)
  `;

  const blob = Buffer.from("fixture", "utf8");

  await sql`
    insert into document_files
      (id, document_id, page_no, storage_key, sha256, byte_size, mime, wrapped_dek, nonce)
    values
      (${FILE.mayaPassport}, ${DOCUMENT.mayaPassport}, 1, 'fixture/maya-passport-1',
        'fixture-hash-1', 1024, 'image/jpeg', ${blob}, ${blob}),
      (${FILE.ivyCounselling}, ${DOCUMENT.ivyCounselling}, 1, 'fixture/ivy-letter-1',
        'fixture-hash-2', 2048, 'application/pdf', ${blob}, ${blob}),
      (${FILE.roseWill}, ${DOCUMENT.roseWill}, 1, 'fixture/rose-will-1',
        'fixture-hash-3', 4096, 'application/pdf', ${blob}, ${blob})
  `;

  // Nothing in the tree connects a person to a business, so reaching one is
  // always an explicit grant — including for the family member who runs it.
  // Third-party access is two independent lists (D18): whose, and which kinds.
  await sql`
    insert into grant_owners (user_id, owner_id) values
      (${USER.sam}, ${OWNER.hale}),
      (${USER.daniel}, ${OWNER.hale}),
      (${USER.tenant}, ${OWNER.hale})
  `;

  await sql`
    insert into grant_categories (user_id, category) values
      (${USER.sam}, 'business'),
      (${USER.sam}, 'financial'),
      (${USER.tenant}, 'business')
  `;

  // The per-record exception: the only route into a private record (D17).
  await sql`
    insert into grant_records (user_id, record_id) values
      (${USER.sam}, ${RECORD.roseWill})
  `;

  await sql`
    insert into emergency_activations (user_id, expires_at, revoked_at, reason) values
      (${USER.medic}, now() + interval '6 hours', null, 'fixture: live window'),
      (${USER.lapsed}, now() - interval '2 hours', null, 'fixture: expired window'),
      (${USER.pulled}, now() + interval '6 hours', now(), 'fixture: revoked window')
  `;

  await sql`insert into settings (id) values (1)`;
}
