import type { ReactNode } from "react";
import { Icon } from "../onyx/components/icon";

export interface AppShellProps { name: string; userMenu?: ReactNode; children?: ReactNode }
export function AppShell({ name, userMenu, children }: AppShellProps) {
  return <div className="bedrock-app">
    <header className="bedrock-header"><a className="bedrock-brand" href="/" aria-label={`${name} home`}><Icon name="circle-filled" /><span>{name}</span></a>{userMenu}</header>
    <main className="bedrock-content">{children}</main>
    <footer className="bedrock-footer">A little space on your personal cloud.</footer>
  </div>;
}
