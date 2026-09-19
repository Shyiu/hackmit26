// Only same-site paths, so a crafted link can't bounce a caregiver off-site after login.
export function safeNext(next: string | string[] | undefined): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
