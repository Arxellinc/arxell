export function typedBridgeEnabledFrom(
  envEnabled: boolean,
  storageEnabled: boolean,
): boolean;

export function createCorrelationIdFrom(args: {
  randomUuid?: (() => string) | undefined;
  now: () => number;
  randomHex: () => string;
}): string;
