export type WorkspaceToolTabId<TToolId extends string = string> = `${TToolId}-tool`;

export type WorkspacePrimaryTab = "events" | "terminal" | "manager-tool";

export type WorkspaceTab = WorkspacePrimaryTab | WorkspaceToolTabId;

export function toWorkspaceToolTabId(toolId: string): WorkspaceToolTabId {
  return `${toolId}-tool`;
}

export function isWorkspaceTab(value: string): value is WorkspaceTab {
  return value === "events" || value === "terminal" || value === "manager-tool" || value.endsWith("-tool");
}
