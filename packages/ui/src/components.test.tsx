import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { BedrockProvider } from "bedrock/react";
import { createClient } from "bedrock/client";
import { AppShell, UserMenu, SignInGate, UploadButton, Button, Input, Textarea, Checkbox, Switch, Progress, Panel, Heading, Icon, Table, TableBody, TableRow, TableCell } from ".";

const client = createClient({ url: "http://notes.localhost:3000", sync: false });
test("Bedrock components render in a provider without browser globals", () => {
  const html = renderToString(<BedrockProvider client={client}><AppShell name="Notes" userMenu={<UserMenu client={client} />}><SignInGate client={client}><p>Private</p></SignInGate><UploadButton bucket="attachments" onUpload={() => {}} /></AppShell></BedrockProvider>);
  expect(html).toContain('aria-label="Notes home"');
  expect(html).toContain("Loading account");
  expect(html).toContain("Loading your space");
  expect(html).not.toContain("Private");
  expect(html).toContain('type="file"');
  expect(html).toContain("Attach file");
});
test("Onyx primitives preserve semantic markup and state", () => {
  const html = renderToString(<Panel><Heading>Editor</Heading><Button disabled>Save</Button><Input aria-label="Title" /><Textarea aria-label="Body" /><Checkbox aria-label="Pinned" defaultChecked /><Switch aria-label="Enabled" /><Progress value={37} aria-label="Upload" /><Icon name="add" /><Table><TableBody><TableRow><TableCell>Note</TableCell></TableRow></TableBody></Table></Panel>);
  expect(html).toContain('data-slot="button"');
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-valuenow="37"');
  expect(html).toContain("codicon-add");
  expect(html).toContain("<table");
  expect(html).toContain('aria-label="Title"');
});
test("Bedrock hooks retain the provider-required error", () => {
  expect(() => renderToString(<UploadButton bucket="attachments" onUpload={() => {}} />)).toThrow("Bedrock hooks need a BedrockProvider");
});
