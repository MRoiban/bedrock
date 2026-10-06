import type { ReactNode } from "react";
import type { Client } from "bedrock/client";
import { useUser } from "bedrock/react";
import { Button } from "../onyx/components/button";
import { Panel, PanelBody } from "../onyx/components/panel";
import { Heading, Text } from "../onyx/components/text";
import { Icon } from "../onyx/components/icon";

export interface SignInGateProps { client: Pick<Client, "loginUrl">; children?: ReactNode; name?: string }
export function SignInGate({ client, children, name = "your pebble" }: SignInGateProps) {
  const { user, isLoading } = useUser();
  if (isLoading) return <p className="bedrock-muted" role="status">Loading your space…</p>;
  if (user) return children;
  return <Panel className="bedrock-sign-in"><PanelBody>
    <Icon name="lock" size="xl" /><Heading>Welcome to {name}</Heading>
    <Text tone="muted">Sign in to make yourself at home.</Text>
    <Button asChild><a href={client.loginUrl()}>Sign in <Icon name="arrow-right" /></a></Button>
  </PanelBody></Panel>;
}
