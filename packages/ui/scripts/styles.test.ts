import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { BedrockProvider } from "bedrock/react";
import { createClient } from "bedrock/client";
import postcss from "postcss";
import { AppShell, Button, SignInGate, UploadButton, UserMenu } from "../src";
import { createElement } from "react";

const root = `${import.meta.dir}/..`;
test("committed CSS contains tokens, Bedrock layouts, rendered utilities, and an embedded icon font", async () => {
  const css = await Bun.file(`${root}/dist/styles.css`).text();
  const tree = postcss.parse(css);
  const selectors: string[] = [];
  tree.walkRules(rule => { selectors.push(rule.selector); });
  expect(css).toContain("--onyx-surface-app:");
  expect(selectors.some(selector => /data-theme=['"]?light['"]?\]/.test(selector))).toBe(true);
  expect(tree.nodes.some(node => node.type === "atrule" && node.name === "import")).toBe(false);
  tree.walkAtRules("tailwind", () => { throw new Error("Standalone CSS must compile all Tailwind directives"); });
  for (const name of ["onyx-checkbox", "onyx-switch", "onyx-floating", "onyx-popover", "onyx-progress", "onyx-toast", "onyx-spinner"])
    expect(selectors.some(selector => selector.includes(`.${name}`))).toBe(true);
  const keyframes: string[] = [];
  tree.walkAtRules("keyframes", rule => { if (rule.params !== "codicon-spin") keyframes.push(rule.params); });
  expect(new Set(keyframes).size).toBe(keyframes.length);
  expect(keyframes).toContain("onyx-sheet-right-enter");
  expect(keyframes).toContain("onyx-indeterminate");
  expect(css).toContain("data:font/ttf;base64,");
  expect(css).not.toMatch(/url\(["']?\.\//);
  const client = createClient({ url: "http://notes.localhost" });
  const html = renderToString(createElement(BedrockProvider, { client }, createElement(AppShell, { name: "Notes", userMenu: createElement(UserMenu, { client }) }, createElement(SignInGate, { client }), createElement(UploadButton, { bucket: "attachments", onUpload() {} }), createElement(Button, {}, "Save"))));
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1]!.split(/\s+/)));
  for (const name of classes) {
    const escaped = name.replace(/[^a-zA-Z0-9_-]/g, character => character === "," ? "\\2c " : `\\${character}`);
    expect(selectors.some(selector => selector.includes(`.${escaped}`)), name).toBe(true);
  }
  const source = await Bun.file(`${root}/src/bedrock/styles.css`).text();
  for (const match of source.matchAll(/\.((?:bedrock-)[\w-]+)/g)) expect(css).toContain(`.${match[1]}`);
});
