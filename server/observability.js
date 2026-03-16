const { trace } = require("@opentelemetry/api");
const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node");

let initialized = false;

function initializeTracing() {
  if (initialized) {
    return;
  }
  const provider = new NodeTracerProvider();
  provider.register();
  initialized = true;
}

function getTracer(name = "qualextract.ai") {
  initializeTracing();
  return trace.getTracer(name);
}

module.exports = {
  initializeTracing,
  getTracer
};