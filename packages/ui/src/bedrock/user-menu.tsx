import { useState } from "react";
import { useUser } from "bedrock/react";
import type { Client } from "bedrock/client";
import { Button } from "../onyx/components/button";
import { Icon } from "../onyx/components/icon";

export interface UserMenuProps { client: Pick<Client, "logout">; onSignOut?: () => void }
export function UserMenu({ client, onSignOut = () => location.reload() }: UserMenuProps) {
  const { user, isLoading } = useUser();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (isLoading) return <span className="bedrock-muted" role="status">Loading account…</span>;
  if (!user) return null;
  async function signOut() {
    setPending(true); setError(undefined);
    try { await client.logout(); onSignOut(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-out failed."); }
    finally { setPending(false); }
  }
  return <div className="bedrock-user-menu">
    {user.avatarUrl ? <img className="bedrock-avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="bedrock-avatar" aria-hidden="true">{(user.name || user.email || user.id).slice(0, 1).toUpperCase()}</span>}
    <span className="bedrock-user-name" title={user.email}>{user.name || user.email || "Account"}</span>
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => void signOut()}><Icon name="sign-out" />{pending ? "Signing out…" : "Sign out"}</Button>
    {error && <span role="alert" className="bedrock-error">{error}</span>}
  </div>;
}
