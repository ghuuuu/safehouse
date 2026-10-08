/**
 * The household the permission tests reason about.
 *
 * Entirely fictional, and deliberately awkward: a divorce, a step-child, a
 * guardianship that ended, a death, a private counselling letter and a private
 * will. A tidy family proves nothing — every rule worth testing is a rule about
 * the untidy case.
 *
 * Sized to PRODUCT.md §Seed data: eleven people across three generations, one
 * business, the household itself, and thirty-six documents across all six
 * categories. It is a test asset before it is a demonstration, so each row is
 * here because some rule has nothing else to act on — see the comments against
 * the records that are not obvious filler.
 *
 * No real names, numbers or addresses. See CLAUDE.md.
 */

import type { Sql } from "postgres";

import { identifierColumns } from "../field-crypto.server";
import type { KeyProvider } from "../keys.server";

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * Expiry dates that mean "soon" are relative, because a literal passes today
 * and goes red on a calendar boundary with nobody having changed anything —
 * which is exactly what happened to the trading permit's 2026-10-01. Dates that
 * mean a fixed point in the household's history stay literal.
 */
function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
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
  /**
   * Third party: the estate attorney. Declared next to Sam because the matrix
   * reads this declaration order, while the id continues the numbering — the
   * two disagree on purpose, since renumbering would break ids retyped into
   * other test files.
   */
  nina: id(111),
  /** Individual whose account has been disabled. */
  tenant: id(106),
  /** Emergency contact with a live window. */
  medic: id(107),
  /** Emergency contact whose window ran out. */
  lapsed: id(108),
  /** Emergency contact whose window the admin revoked. */
  pulled: id(109),
  /**
   * An account and nothing more: no person, not disabled, never given a grant.
   * The state a newly created account is in before the admin attaches it to
   * somebody in the tree. It must reach nothing at all (D24).
   */
  stranger: id(110),
} as const;

/** PRODUCT.md §Taxonomy. The table had no rows at all before this. */
export const SUBCATEGORY = {
  passports: id(500),
  nationalId: id(501),
  licences: id(502),
  birthCertificates: id(503),
  marriageCertificates: id(504),
  labs: id(505),
  imaging: id(506),
  immunisations: id(507),
  prescriptions: id(508),
  insuranceCards: id(509),
  visitSummaries: id(510),
  permits: id(511),
  registrations: id(512),
  contracts: id(513),
  bankStatements: id(514),
  insurancePolicies: id(515),
  taxReturns: id(516),
  wills: id(517),
  deeds: id(518),
  powerOfAttorney: id(519),
  warranties: id(520),
  school: id(521),
  receipts: id(522),
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
  rosePassport: id(211),
  danielPassport: id(212),
  mayaDrivingLicence: id(213),
  ivyBirthCertificate: id(214),
  householdMarriageCertificate: id(215),
  ivyInsuranceCard: id(216),
  /** On a deceased owner: `people.died_on` is read by no view (D16). */
  frankVisitSummary: id(217),
  haleRegistration: id(218),
  haleClientContract: id(219),
  haleLeaseContract: id(220),
  haleInsurancePolicy: id(221),
  /**
   * Private, on a business. Sam's grant matches both axes — this owner and this
   * category — and is stopped by the privacy flag alone (D18, D23).
   */
  haleBankStatement: id(222),
  /** Sam's first negative where the category matches and the owner does not. */
  danielTaxReturn: id(223),
  /** Private, in a category break-glass cannot reach, with a spouse next door. */
  mayaSavingsStatement: id(224),
  householdHomeInsurance: id(225),
  /** Same owner and category as the will, one flag apart. Nina reaches this one. */
  rosePowerOfAttorney: id(226),
  danielDivorceDecree: id(227),
  /** Private and legal, so break-glass does reach it (D17). */
  mayaAdvanceDirective: id(228),
  householdApplianceWarranty: id(229),
  /** Behind the live guardianship, outside the categories break-glass reaches. */
  lenaSchoolEnrolment: id(230),
  /** Behind the guardianship that ended. */
  bramTenancyDeposit: id(231),
} as const;

export const DOCUMENT = {
  mayaPassportOld: id(340),
  mayaPassport: id(300),
  danielLicenceOld: id(301),
  danielLicence: id(302),
  ivyImmunisation: id(303),
  ivyCounselling: id(304),
  roseWillOld: id(341),
  roseWill: id(305),
  householdDeed: id(306),
  halePermitOld: id(342),
  halePermit: id(307),
  haleTaxReturn: id(308),
  theoPassport: id(309),
  nadiaPassport: id(310),
  lenaCarePlan: id(311),
  rosePassport: id(312),
  danielPassport: id(313),
  mayaDrivingLicence: id(314),
  ivyBirthCertificate: id(315),
  householdMarriageCertificate: id(316),
  ivyInsuranceCard: id(317),
  frankVisitSummary: id(318),
  haleRegistration: id(319),
  haleClientContract: id(320),
  haleLeaseContract: id(321),
  haleInsurancePolicy: id(322),
  haleBankStatement: id(323),
  danielTaxReturn: id(324),
  mayaSavingsStatement: id(325),
  householdHomeInsurance: id(326),
  rosePowerOfAttorney: id(327),
  danielDivorceDecree: id(328),
  mayaAdvanceDirective: id(329),
  householdApplianceWarranty: id(330),
  lenaSchoolEnrolment: id(331),
  bramTenancyDeposit: id(332),
} as const;

export const FILE = {
  mayaPassport: id(400),
  ivyCounselling: id(401),
  roseWill: id(402),
  roseWillOld: id(403),
  halePermitOld: id(404),
  halePermit: id(405),
  haleTaxReturn: id(406),
  householdDeed: id(407),
  /** Page two of the deed: the only multi-page document in the fixture. */
  householdDeedPage2: id(408),
  ivyImmunisation: id(409),
  mayaPassportOld: id(410),
  danielLicence: id(411),
  mayaAdvanceDirective: id(412),
  haleBankStatement: id(413),
  rosePowerOfAttorney: id(414),
  bramTenancyDeposit: id(415),
  lenaSchoolEnrolment: id(416),
} as const;

/**
 * The fixture's identifiers, made up and marked as such (CLAUDE.md). Stored
 * sealed, like every identifier (D35): `insertFixture` seals them under
 * whichever key it is given.
 */
export const IDENTIFIER = {
  mayaPassportOld: "FIXTURE-PP-0001-A",
  mayaPassport: "FIXTURE-PP-0001",
  danielLicenceOld: "FIXTURE-DL-0001",
  danielLicence: "FIXTURE-DL-0002",
  householdDeed: "FIXTURE-DEED-0001",
  halePermitOld: "FIXTURE-PERMIT-0001",
  halePermit: "FIXTURE-PERMIT-0002",
  theoPassport: "FIXTURE-PP-0002",
  nadiaPassport: "FIXTURE-PP-0003",
  rosePassport: "FIXTURE-PP-0004",
  danielPassport: "FIXTURE-PP-0005",
  mayaDrivingLicence: "FIXTURE-DL-0003",
  ivyBirthCertificate: "FIXTURE-BC-0001",
  householdMarriageCertificate: "FIXTURE-MC-0001",
  ivyInsuranceCard: "FIXTURE-HI-0001",
  haleRegistration: "FIXTURE-REG-0001",
  haleClientContract: "FIXTURE-CON-0001",
  haleLeaseContract: "FIXTURE-CON-0002",
  haleInsurancePolicy: "FIXTURE-POL-0001",
  householdHomeInsurance: "FIXTURE-POL-0002",
  householdApplianceWarranty: "FIXTURE-WAR-0001",
  bramTenancyDeposit: "FIXTURE-REC-0001",
} as const satisfies Partial<Record<keyof typeof DOCUMENT, string>>;

/**
 * The key the test database's identifiers are sealed under. Not a secret: it
 * opens nothing but the made-up numbers above. A test that reveals one writes
 * this to its key file.
 */
export const FIXTURE_KEY = Buffer.alloc(32, 0x5a);

export async function insertFixture(sql: Sql, provider: KeyProvider): Promise<void> {
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
    insert into people (owner_id, given_name, family_name, born_on, died_on, sex) values
      (${OWNER.rose}, 'Rose', 'Adeyemi', '1951-03-04', null, 'female'),
      (${OWNER.frank}, 'Frank', 'Adeyemi', '1949-11-19', '2021-06-02', 'male'),
      (${OWNER.maya}, 'Maya', 'Adeyemi', '1979-07-22', null, 'female'),
      (${OWNER.daniel}, 'Daniel', 'Hale', '1977-01-30', null, 'male'),
      (${OWNER.ivy}, 'Ivy', 'Hale', '2004-09-14', null, 'female'),
      (${OWNER.theo}, 'Theo', 'Hale', '2001-04-08', null, 'male'),
      (${OWNER.nadia}, 'Nadia', 'Brandt', '1978-02-11', null, 'female'),
      (${OWNER.omar}, 'Omar', 'Brandt', '1950-08-30', null, 'male'),
      (${OWNER.lena}, 'Lena', 'Okonjo', '2011-12-01', null, 'female'),
      -- Left unrecorded on purpose, so the tree's "not recorded" case is drawn.
      (${OWNER.bram}, 'Bram', 'Okonjo', '2003-05-17', null, null),
      (${OWNER.priya}, 'Priya', 'Raman', '1968-10-06', null, 'female')
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
      (${USER.nina}, 'nina@example.invalid', 'Nina Faruq', 'third_party', null, null),
      (${USER.tenant}, 'tenant@example.invalid', 'Former Lodger', 'individual', null, now()),
      (${USER.medic}, 'medic@example.invalid', 'Emergency Contact', 'emergency', null, null),
      (${USER.lapsed}, 'lapsed@example.invalid', 'Lapsed Contact', 'emergency', null, null),
      (${USER.pulled}, 'pulled@example.invalid', 'Revoked Contact', 'emergency', null, null),
      (${USER.stranger}, 'stranger@example.invalid', 'Unattached Account', 'individual', null, null)
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
    insert into subcategories (id, category, slug, label) values
      (${SUBCATEGORY.passports}, 'personal', 'passports', 'Passports'),
      (${SUBCATEGORY.nationalId}, 'personal', 'national_id', 'National ID'),
      (${SUBCATEGORY.licences}, 'personal', 'licences', 'Licences'),
      (${SUBCATEGORY.birthCertificates}, 'personal', 'birth_certificates', 'Birth certificates'),
      (${SUBCATEGORY.marriageCertificates}, 'personal', 'marriage_certificates', 'Marriage certificates'),
      (${SUBCATEGORY.labs}, 'medical', 'labs', 'Labs'),
      (${SUBCATEGORY.imaging}, 'medical', 'imaging', 'Imaging'),
      (${SUBCATEGORY.immunisations}, 'medical', 'immunisations', 'Immunisations'),
      (${SUBCATEGORY.prescriptions}, 'medical', 'prescriptions', 'Prescriptions'),
      (${SUBCATEGORY.insuranceCards}, 'medical', 'insurance_cards', 'Insurance cards'),
      (${SUBCATEGORY.visitSummaries}, 'medical', 'visit_summaries', 'Visit summaries'),
      (${SUBCATEGORY.permits}, 'business', 'permits', 'Permits'),
      (${SUBCATEGORY.registrations}, 'business', 'registrations', 'Registrations'),
      (${SUBCATEGORY.contracts}, 'business', 'contracts', 'Contracts'),
      (${SUBCATEGORY.bankStatements}, 'financial', 'bank_statements', 'Bank statements'),
      (${SUBCATEGORY.insurancePolicies}, 'financial', 'insurance_policies', 'Insurance policies'),
      (${SUBCATEGORY.taxReturns}, 'financial', 'tax_returns', 'Tax returns'),
      (${SUBCATEGORY.wills}, 'legal', 'wills', 'Wills'),
      (${SUBCATEGORY.deeds}, 'legal', 'deeds', 'Deeds'),
      (${SUBCATEGORY.powerOfAttorney}, 'legal', 'power_of_attorney', 'Power of attorney'),
      (${SUBCATEGORY.warranties}, 'general', 'warranties', 'Warranties'),
      (${SUBCATEGORY.school}, 'general', 'school', 'School'),
      (${SUBCATEGORY.receipts}, 'general', 'receipts', 'Receipts')
  `;

  // A counselling letter, a care plan and a divorce decree have no subcategory
  // in PRODUCT.md's taxonomy, and keeping them null is what proves the column
  // is nullable and the "no subcategory" case is reachable.
  await sql`
    insert into records (id, owner_id, category, subcategory_id, kind, title, is_private) values
      (${RECORD.mayaPassport}, ${OWNER.maya}, 'personal', ${SUBCATEGORY.passports}, 'passport', 'Passport', false),
      (${RECORD.danielLicence}, ${OWNER.daniel}, 'personal', ${SUBCATEGORY.licences}, 'driving_licence', 'Driving licence', false),
      (${RECORD.ivyImmunisation}, ${OWNER.ivy}, 'medical', ${SUBCATEGORY.immunisations}, 'immunisation', 'Immunisation record', false),
      (${RECORD.ivyCounselling}, ${OWNER.ivy}, 'medical', null, 'letter', 'Counselling letter', true),
      (${RECORD.roseWill}, ${OWNER.rose}, 'legal', ${SUBCATEGORY.wills}, 'will', 'Last will', true),
      (${RECORD.householdDeed}, ${OWNER.household}, 'legal', ${SUBCATEGORY.deeds}, 'deed', 'House deed', false),
      (${RECORD.halePermit}, ${OWNER.hale}, 'business', ${SUBCATEGORY.permits}, 'permit', 'Trading permit', false),
      (${RECORD.haleTaxReturn}, ${OWNER.hale}, 'financial', ${SUBCATEGORY.taxReturns}, 'tax_return', 'Tax return', false),
      (${RECORD.theoPassport}, ${OWNER.theo}, 'personal', ${SUBCATEGORY.passports}, 'passport', 'Passport', false),
      (${RECORD.nadiaPassport}, ${OWNER.nadia}, 'personal', ${SUBCATEGORY.passports}, 'passport', 'Passport', false),
      (${RECORD.lenaCarePlan}, ${OWNER.lena}, 'medical', null, 'care_plan', 'Care plan', false),
      (${RECORD.rosePassport}, ${OWNER.rose}, 'personal', ${SUBCATEGORY.passports}, 'passport', 'Passport', false),
      (${RECORD.danielPassport}, ${OWNER.daniel}, 'personal', ${SUBCATEGORY.passports}, 'passport', 'Passport', false),
      (${RECORD.mayaDrivingLicence}, ${OWNER.maya}, 'personal', ${SUBCATEGORY.licences}, 'driving_licence', 'Driving licence', false),
      (${RECORD.ivyBirthCertificate}, ${OWNER.ivy}, 'personal', ${SUBCATEGORY.birthCertificates}, 'birth_certificate', 'Birth certificate', false),
      (${RECORD.householdMarriageCertificate}, ${OWNER.household}, 'personal', ${SUBCATEGORY.marriageCertificates}, 'marriage_certificate', 'Marriage certificate', false),
      (${RECORD.ivyInsuranceCard}, ${OWNER.ivy}, 'medical', ${SUBCATEGORY.insuranceCards}, 'insurance_card', 'Health insurance card', false),
      (${RECORD.frankVisitSummary}, ${OWNER.frank}, 'medical', ${SUBCATEGORY.visitSummaries}, 'visit_summary', 'Final visit summary', false),
      (${RECORD.haleRegistration}, ${OWNER.hale}, 'business', ${SUBCATEGORY.registrations}, 'registration', 'Certificate of formation', false),
      (${RECORD.haleClientContract}, ${OWNER.hale}, 'business', ${SUBCATEGORY.contracts}, 'contract', 'Client services agreement', false),
      (${RECORD.haleLeaseContract}, ${OWNER.hale}, 'business', ${SUBCATEGORY.contracts}, 'contract', 'Office lease', false),
      (${RECORD.haleInsurancePolicy}, ${OWNER.hale}, 'financial', ${SUBCATEGORY.insurancePolicies}, 'insurance_policy', 'Liability insurance', false),
      (${RECORD.haleBankStatement}, ${OWNER.hale}, 'financial', ${SUBCATEGORY.bankStatements}, 'bank_statement', 'Business account statement', true),
      (${RECORD.danielTaxReturn}, ${OWNER.daniel}, 'financial', ${SUBCATEGORY.taxReturns}, 'tax_return', 'Tax return', false),
      (${RECORD.mayaSavingsStatement}, ${OWNER.maya}, 'financial', ${SUBCATEGORY.bankStatements}, 'bank_statement', 'Savings statement', true),
      (${RECORD.householdHomeInsurance}, ${OWNER.household}, 'financial', ${SUBCATEGORY.insurancePolicies}, 'insurance_policy', 'Home insurance', false),
      (${RECORD.rosePowerOfAttorney}, ${OWNER.rose}, 'legal', ${SUBCATEGORY.powerOfAttorney}, 'power_of_attorney', 'Power of attorney', false),
      (${RECORD.danielDivorceDecree}, ${OWNER.daniel}, 'legal', null, 'decree', 'Divorce decree', false),
      (${RECORD.mayaAdvanceDirective}, ${OWNER.maya}, 'legal', ${SUBCATEGORY.powerOfAttorney}, 'advance_directive', 'Advance directive', true),
      (${RECORD.householdApplianceWarranty}, ${OWNER.household}, 'general', ${SUBCATEGORY.warranties}, 'warranty', 'Boiler warranty', false),
      (${RECORD.lenaSchoolEnrolment}, ${OWNER.lena}, 'general', ${SUBCATEGORY.school}, 'school_record', 'School enrolment letter', false),
      (${RECORD.bramTenancyDeposit}, ${OWNER.bram}, 'general', ${SUBCATEGORY.receipts}, 'receipt', 'Tenancy deposit receipt', false)
  `;

  // Three records carry a superseded version behind the current one. Exactly
  // one row per record is current, which `documents_one_current` enforces.
  await sql`
    insert into documents
      (id, record_id, version_no, is_current, identifier, expires_on, document_date, issued_on, issuer_country, place_of_issue, original_location_note, details)
    values
      (${DOCUMENT.mayaPassportOld}, ${RECORD.mayaPassport}, 1, false, null, '2019-02-28', null, '2009-02-28', 'ZZ', 'Fixture City', 'Fireproof box, upstairs cupboard', '{"pages": 32, "endorsements": "none"}'),
      (${DOCUMENT.mayaPassport}, ${RECORD.mayaPassport}, 2, true, null, '2029-01-31', null, '2019-02-01', 'ZZ', 'Fixture City', 'Fireproof box, upstairs cupboard', '{"pages": 32, "endorsements": "none"}'),
      (${DOCUMENT.danielLicenceOld}, ${RECORD.danielLicence}, 1, false, null, '2024-05-05', null, null, null, null, null, '{}'),
      (${DOCUMENT.danielLicence}, ${RECORD.danielLicence}, 2, true, null, '2034-05-05', null, null, null, null, null, '{}'),
      (${DOCUMENT.ivyImmunisation}, ${RECORD.ivyImmunisation}, 1, true, null, null, null, null, null, null, null, '{}'),
      (${DOCUMENT.ivyCounselling}, ${RECORD.ivyCounselling}, 1, true, null, null, null, null, null, null, null, '{}'),
      (${DOCUMENT.roseWillOld}, ${RECORD.roseWill}, 1, false, null, null, '2014-09-02', null, null, null, null, '{}'),
      (${DOCUMENT.roseWill}, ${RECORD.roseWill}, 2, true, null, null, '2023-11-30', null, null, null, 'Solicitor holds the original', '{}'),
      (${DOCUMENT.householdDeed}, ${RECORD.householdDeed}, 1, true, null, null, '2016-04-11', null, null, null, 'Solicitor holds the original', '{"parcel": "north plot"}'),
      (${DOCUMENT.halePermitOld}, ${RECORD.halePermit}, 1, false, null, '2025-09-30', null, '2020-10-01', null, null, null, '{}'),
      (${DOCUMENT.halePermit}, ${RECORD.halePermit}, 2, true, null, ${inDays(26)}, null, '2025-10-01', null, null, null, '{}'),
      (${DOCUMENT.haleTaxReturn}, ${RECORD.haleTaxReturn}, 1, true, null, null, '2025-01-31', null, null, null, null, '{}'),
      (${DOCUMENT.theoPassport}, ${RECORD.theoPassport}, 1, true, null, '2031-03-19', null, null, null, null, null, '{}'),
      (${DOCUMENT.nadiaPassport}, ${RECORD.nadiaPassport}, 1, true, null, '2030-07-07', null, null, null, null, null, '{}'),
      (${DOCUMENT.lenaCarePlan}, ${RECORD.lenaCarePlan}, 1, true, null, null, '2025-03-12', null, null, null, null, '{}'),
      (${DOCUMENT.rosePassport}, ${RECORD.rosePassport}, 1, true, null, ${inDays(12)}, null, null, null, null, null, '{}'),
      (${DOCUMENT.danielPassport}, ${RECORD.danielPassport}, 1, true, null, ${inDays(-40)}, null, null, null, null, null, '{}'),
      (${DOCUMENT.mayaDrivingLicence}, ${RECORD.mayaDrivingLicence}, 1, true, null, ${inDays(74)}, null, null, null, null, null, '{}'),
      (${DOCUMENT.ivyBirthCertificate}, ${RECORD.ivyBirthCertificate}, 1, true, null, null, '2004-09-20', null, null, null, null, '{}'),
      (${DOCUMENT.householdMarriageCertificate}, ${RECORD.householdMarriageCertificate}, 1, true, null, null, '2012-08-18', null, null, null, null, '{}'),
      (${DOCUMENT.ivyInsuranceCard}, ${RECORD.ivyInsuranceCard}, 1, true, null, ${inDays(89)}, null, null, null, null, null, '{}'),
      (${DOCUMENT.frankVisitSummary}, ${RECORD.frankVisitSummary}, 1, true, null, null, '2021-05-28', null, null, null, null, '{}'),
      (${DOCUMENT.haleRegistration}, ${RECORD.haleRegistration}, 1, true, null, null, '2015-02-01', null, null, null, null, '{}'),
      (${DOCUMENT.haleClientContract}, ${RECORD.haleClientContract}, 1, true, null, '2027-06-30', '2025-07-01', null, null, null, null, '{}'),
      (${DOCUMENT.haleLeaseContract}, ${RECORD.haleLeaseContract}, 1, true, null, ${inDays(45)}, '2023-11-20', null, null, null, null, '{}'),
      (${DOCUMENT.haleInsurancePolicy}, ${RECORD.haleInsurancePolicy}, 1, true, null, ${inDays(103)}, null, null, null, null, null, '{}'),
      (${DOCUMENT.haleBankStatement}, ${RECORD.haleBankStatement}, 1, true, null, null, '2026-08-31', null, null, null, null, '{}'),
      (${DOCUMENT.danielTaxReturn}, ${RECORD.danielTaxReturn}, 1, true, null, null, '2026-01-31', null, null, null, null, '{}'),
      (${DOCUMENT.mayaSavingsStatement}, ${RECORD.mayaSavingsStatement}, 1, true, null, null, '2026-08-31', null, null, null, null, '{}'),
      (${DOCUMENT.householdHomeInsurance}, ${RECORD.householdHomeInsurance}, 1, true, null, ${inDays(58)}, null, null, null, null, null, '{}'),
      (${DOCUMENT.rosePowerOfAttorney}, ${RECORD.rosePowerOfAttorney}, 1, true, null, null, '2022-02-14', null, null, null, 'Solicitor holds the original', '{}'),
      (${DOCUMENT.danielDivorceDecree}, ${RECORD.danielDivorceDecree}, 1, true, null, null, '2010-03-22', null, null, null, null, '{}'),
      (${DOCUMENT.mayaAdvanceDirective}, ${RECORD.mayaAdvanceDirective}, 1, true, null, null, '2024-06-05', null, null, null, null, '{}'),
      (${DOCUMENT.householdApplianceWarranty}, ${RECORD.householdApplianceWarranty}, 1, true, null, ${inDays(67)}, '2024-12-12', null, null, null, null, '{}'),
      (${DOCUMENT.lenaSchoolEnrolment}, ${RECORD.lenaSchoolEnrolment}, 1, true, null, null, '2026-09-01', null, null, null, null, '{}'),
      (${DOCUMENT.bramTenancyDeposit}, ${RECORD.bramTenancyDeposit}, 1, true, null, null, '2021-05-17', null, null, null, null, '{}')
  `;

  for (const [document, value] of Object.entries(IDENTIFIER)) {
    const documentId = DOCUMENT[document as keyof typeof IDENTIFIER];
    const columns = identifierColumns(value, documentId, provider);
    await sql`
      update documents
      set identifier_sealed = ${columns.sealed}, identifier_fp = ${columns.fp},
          identifier_last4_fp = ${columns.last4}
      where id = ${documentId}
    `;
  }

  // Which expiry dates a human has actually agreed with (D26). Nothing acts on
  // an unconfirmed one, so a fixture that confirmed nothing would make the
  // expiry list empty and every assertion about it vacuous.
  //
  // Two absences are the point. The office lease (45 days out, well inside any
  // sensible window) is deliberately left unconfirmed: it is the negative in
  // expiry.test.ts. The superseded trading permit IS confirmed and long expired,
  // so `is_current` is the only thing keeping it quiet.
  await sql`
    update documents set confirmed_fields = '["expires_on"]'::jsonb
    where id in (
      ${DOCUMENT.rosePassport},
      ${DOCUMENT.danielPassport},
      ${DOCUMENT.halePermit},
      ${DOCUMENT.halePermitOld},
      ${DOCUMENT.householdHomeInsurance},
      ${DOCUMENT.householdApplianceWarranty},
      ${DOCUMENT.mayaDrivingLicence},
      ${DOCUMENT.ivyInsuranceCard},
      ${DOCUMENT.haleInsurancePolicy},
      ${DOCUMENT.danielLicence},
      ${DOCUMENT.haleClientContract}
    )
  `;

  const blob = Buffer.from("fixture", "utf8");

  // One file behind every independent path to a document: the family circle, a
  // private record's own owner, a per-record grant across two versions, a
  // third-party category grant, the household's shared papers, break-glass into
  // a private file, a private record on a business, the attorney's one record,
  // and both guardianships.
  await sql`
    insert into document_files
      (id, document_id, page_no, storage_key, sha256, byte_size, mime, wrapped_dek, nonce)
    values
      (${FILE.mayaPassport}, ${DOCUMENT.mayaPassport}, 1, 'fixture/maya-passport-1', 'fixture-hash-1', 1024, 'image/jpeg', ${blob}, ${blob}),
      (${FILE.ivyCounselling}, ${DOCUMENT.ivyCounselling}, 1, 'fixture/ivy-letter-1', 'fixture-hash-2', 2048, 'application/pdf', ${blob}, ${blob}),
      (${FILE.roseWill}, ${DOCUMENT.roseWill}, 1, 'fixture/rose-will-1', 'fixture-hash-3', 4096, 'application/pdf', ${blob}, ${blob}),
      (${FILE.roseWillOld}, ${DOCUMENT.roseWillOld}, 1, 'fixture/rose-will-v1-1', 'fixture-hash-4', 4096, 'application/pdf', ${blob}, ${blob}),
      (${FILE.halePermitOld}, ${DOCUMENT.halePermitOld}, 1, 'fixture/hale-permit-v1-1', 'fixture-hash-5', 1536, 'application/pdf', ${blob}, ${blob}),
      (${FILE.halePermit}, ${DOCUMENT.halePermit}, 1, 'fixture/hale-permit-v2-1', 'fixture-hash-6', 1600, 'application/pdf', ${blob}, ${blob}),
      (${FILE.haleTaxReturn}, ${DOCUMENT.haleTaxReturn}, 1, 'fixture/hale-tax-1', 'fixture-hash-7', 8192, 'application/pdf', ${blob}, ${blob}),
      (${FILE.householdDeed}, ${DOCUMENT.householdDeed}, 1, 'fixture/household-deed-1', 'fixture-hash-8', 6144, 'application/pdf', ${blob}, ${blob}),
      (${FILE.householdDeedPage2}, ${DOCUMENT.householdDeed}, 2, 'fixture/household-deed-2', 'fixture-hash-9', 5120, 'application/pdf', ${blob}, ${blob}),
      (${FILE.ivyImmunisation}, ${DOCUMENT.ivyImmunisation}, 1, 'fixture/ivy-immunisation-1', 'fixture-hash-10', 900, 'image/png', ${blob}, ${blob}),
      (${FILE.mayaPassportOld}, ${DOCUMENT.mayaPassportOld}, 1, 'fixture/maya-passport-v1-1', 'fixture-hash-11', 1024, 'image/jpeg', ${blob}, ${blob}),
      (${FILE.danielLicence}, ${DOCUMENT.danielLicence}, 1, 'fixture/daniel-licence-v2-1', 'fixture-hash-12', 1100, 'image/jpeg', ${blob}, ${blob}),
      (${FILE.mayaAdvanceDirective}, ${DOCUMENT.mayaAdvanceDirective}, 1, 'fixture/maya-directive-1', 'fixture-hash-13', 2200, 'application/pdf', ${blob}, ${blob}),
      (${FILE.haleBankStatement}, ${DOCUMENT.haleBankStatement}, 1, 'fixture/hale-statement-1', 'fixture-hash-14', 3300, 'application/pdf', ${blob}, ${blob}),
      (${FILE.rosePowerOfAttorney}, ${DOCUMENT.rosePowerOfAttorney}, 1, 'fixture/rose-poa-1', 'fixture-hash-15', 2600, 'application/pdf', ${blob}, ${blob}),
      (${FILE.bramTenancyDeposit}, ${DOCUMENT.bramTenancyDeposit}, 1, 'fixture/bram-deposit-1', 'fixture-hash-16', 400, 'image/png', ${blob}, ${blob}),
      (${FILE.lenaSchoolEnrolment}, ${DOCUMENT.lenaSchoolEnrolment}, 1, 'fixture/lena-enrolment-1', 'fixture-hash-17', 700, 'application/pdf', ${blob}, ${blob})
  `;

  // Nothing in the tree connects a person to a business, so reaching one is
  // always an explicit grant — including for the family member who runs it.
  // Third-party access is two independent lists (D18): whose, and which kinds.
  //
  // Nina the attorney is granted people and the household, never the business,
  // so the accountant's reach stays exactly the business and the two of them
  // never overlap.
  await sql`
    insert into grant_owners (user_id, owner_id) values
      (${USER.sam}, ${OWNER.hale}),
      (${USER.daniel}, ${OWNER.hale}),
      (${USER.tenant}, ${OWNER.hale}),
      (${USER.nina}, ${OWNER.rose}),
      (${USER.nina}, ${OWNER.maya}),
      (${USER.nina}, ${OWNER.daniel}),
      (${USER.nina}, ${OWNER.household})
  `;

  await sql`
    insert into grant_categories (user_id, category) values
      (${USER.sam}, 'business'),
      (${USER.sam}, 'financial'),
      (${USER.tenant}, 'business'),
      (${USER.nina}, 'legal')
  `;

  // The per-record exception: the only route into a private record (D17).
  // Nina deliberately has none — what matters about her is that the will stays
  // out of reach when the owner and the category are both granted.
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

  // Identifiers only, never a title or a file name (CLAUDE.md). Both of these
  // tables have policies that no test could tell from an empty table.
  await sql`
    insert into activity_events (actor_user_id, action, subject_type, subject_id) values
      (${USER.maya}, 'document.viewed', 'document', ${DOCUMENT.mayaPassport}),
      (${USER.priya}, 'grant.created', 'user', ${USER.nina})
  `;

  await sql`
    insert into notifications (user_id, kind, subject_type, subject_id) values
      (${USER.maya}, 'expiry.soon', 'document', ${DOCUMENT.mayaDrivingLicence}),
      (${USER.priya}, 'emergency.activated', 'user', ${USER.medic})
  `;

  await sql`insert into settings (id) values (1)`;
}
