require("../server/loadEnv");

const { runAiConnectivityCheck } = require("../server/aiClient");

async function main() {
  const result = await runAiConnectivityCheck();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});