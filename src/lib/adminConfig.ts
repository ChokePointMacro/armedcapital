// ── Admin Configuration ──────────────────────────────────────────────────────
// Define admin emails here. Only these users get access to billing,
// budget controls, and other sensitive admin-only features.
// TODO: Move to env var or database for production security.

export const ADMIN_EMAILS: string[] = [
  'm@aol.com',
  'michael.nield7@gmail.com',
  // Add additional admin emails here
];

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
