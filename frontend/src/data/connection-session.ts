// Supabase can emit SIGNED_IN again when a tab gains focus and TOKEN_REFRESHED
// while getSession runs. Only an identity change should invalidate OAuth work.
export function connectionIdentityChanged(previous: string | null | undefined, next: string | null): boolean {
  return previous !== next;
}
