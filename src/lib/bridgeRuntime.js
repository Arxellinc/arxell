export function typedBridgeEnabledFrom(envEnabled, storageEnabled) {
  return envEnabled || storageEnabled;
}

export function createCorrelationIdFrom({ randomUuid, now, randomHex }) {
  if (typeof randomUuid === "function") {
    return randomUuid();
  }
  return `corr-${now()}-${randomHex()}`;
}
