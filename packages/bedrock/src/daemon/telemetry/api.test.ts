import { expect, test } from "bun:test";
import { telemetryQuery } from "./api";

for (const [parameter, value] of [["limit", "0"], ["limit", "1001"], ["since", "0s"], ["since", "366d"], ["step", "2m"]]) {
  test(`API validation names invalid ${parameter}`, () => {
    try {
      telemetryQuery(new URL(`http://localhost/metrics?${parameter}=${value}`), "metrics", "notes");
      throw new Error("Expected invalid arguments");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining(`${parameter} '${value}'`) });
    }
  });
}
