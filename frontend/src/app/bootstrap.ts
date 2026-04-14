export interface CoreBootstrapDeps {
  refreshConversations: () => Promise<void>;
  refreshTools: () => Promise<void>;
  refreshFlowRuns: () => Promise<void>;
  refreshApiConnections: () => Promise<void>;
  refreshTtsState: () => Promise<void>;
  onTtsBootstrapError: (error: unknown) => void;
  refreshDevicesState: () => Promise<void>;
  refreshLlamaRuntime: () => Promise<void>;
  refreshModelManagerInstalled: () => Promise<void>;
  shouldRefreshUnslothUdCatalog: () => boolean;
  refreshModelManagerUnslothUdCatalog: () => Promise<void>;
  autoStartLlamaRuntimeIfConfigured: () => Promise<void>;
  loadConversation: () => Promise<void>;
}

export async function runCoreBootstrapSteps(deps: CoreBootstrapDeps): Promise<void> {
  await deps.refreshConversations();
  await deps.refreshTools();
  await deps.refreshFlowRuns();
  await deps.refreshApiConnections();
  try {
    await deps.refreshTtsState();
  } catch (error) {
    deps.onTtsBootstrapError(error);
  }
  await deps.refreshDevicesState();
  await deps.refreshLlamaRuntime();
  await deps.refreshModelManagerInstalled();
  if (deps.shouldRefreshUnslothUdCatalog()) {
    await deps.refreshModelManagerUnslothUdCatalog();
  }
  await deps.autoStartLlamaRuntimeIfConfigured();
  await deps.loadConversation();
}
