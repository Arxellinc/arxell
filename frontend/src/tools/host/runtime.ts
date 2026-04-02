import type { ToolModule } from "./types";
import type { ToolHostStore } from "./store";

export function registerToolModules(
  store: ToolHostStore,
  modules: Array<ToolModule<unknown>>
): void {
  for (const module of modules) {
    store.register(module);
  }
}
