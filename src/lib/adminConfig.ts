// ── Admin Configuration ──────────────────────────────────────────────────────
// Admin emails are read from the ADMIN_EMAILS env var (comma-separated).
// Example: ADMIN_EMAILS="alice@example.com,bob@example.com"

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
