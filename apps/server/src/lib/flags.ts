export function authDisabled() {
  const value = process.env.AUTH_DISABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}
