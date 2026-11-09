import { createTemplate } from "./template";
import { asBedrockError } from "../error";
try {
  const result = await createTemplate(process.env.BEDROCK_TEST_DIR!, process.env.BEDROCK_TEST_TEMPLATE!, process.env.BEDROCK_TEST_LIST === "1");
  await Bun.write(process.env.BEDROCK_TEST_MANIFEST!, JSON.stringify({ ok: true, value: result }));
} catch (error) {
  await Bun.write(process.env.BEDROCK_TEST_MANIFEST!, JSON.stringify({ ok: false, error: asBedrockError(error, "TEST_SETUP_FAILED", "Check the pebble, migrations, and test seed.").toJSON() }));
  process.exitCode = 2;
}
