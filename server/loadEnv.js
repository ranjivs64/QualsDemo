const path = require("node:path");

function loadLocalEnv() {
  if (typeof process.loadEnvFile !== "function") {
    return;
  }

  const envPath = path.join(__dirname, "..", ".env");
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

loadLocalEnv();
