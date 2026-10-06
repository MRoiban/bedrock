import { expect, test } from "bun:test";
import { Cloudflare } from "./client";

function api(result: unknown) {
  return new Cloudflare("fake-token", "https://mock.invalid", (async () => Response.json({ success: true, result })) as unknown as typeof fetch);
}

test("Cloudflare null lists are empty and zone discovery gives a typed error", async () => {
  const client = api(null);
  expect(await client.tunnels("account")).toEqual([]);
  expect(await client.dns("zone", "*.example.com")).toEqual([]);
  await expect(client.discover("example.com")).rejects.toMatchObject({ code: "CLOUDFLARE_ZONE_MISSING" });
});

test("Cloudflare missing object results fail before callers dereference them; null deletion succeeds", async () => {
  const client = api(null);
  for (const method of ["GET", "POST", "PUT"]) await expect(client.call("/resource", method)).rejects.toMatchObject({ code: "CLOUDFLARE_RESPONSE_INVALID" });
  expect(await client.call("/resource", "DELETE")).toBeNull();
});

for (const result of [{}, [null]]) test(`Cloudflare rejects malformed lists ${JSON.stringify(result)}`, async () => {
  await expect(api(result).tunnels("account")).rejects.toMatchObject({ code: "CLOUDFLARE_RESPONSE_INVALID" });
});

test("Cloudflare null envelope and null error entries produce typed errors", async () => {
  for (const value of [null, { success: false, errors: [null] }]) {
    const client = new Cloudflare("fake-token", "https://mock.invalid", (async () => Response.json(value)) as unknown as typeof fetch);
    await expect(client.tunnels("account")).rejects.toMatchObject({ code: "CLOUDFLARE_API_FAILED" });
  }
});
