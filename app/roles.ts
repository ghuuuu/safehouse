/** What each role is called on screen, everywhere (the database's word is in code only). */
export const ROLE_LABEL: Record<string, string> = {
  admin: "administrator",
  individual: "household member",
  third_party: "third party",
  emergency: "emergency contact",
};

export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role;
