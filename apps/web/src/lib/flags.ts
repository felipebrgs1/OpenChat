export function authDisabled() {
  const value = import.meta.env.VITE_AUTH_DISABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}
