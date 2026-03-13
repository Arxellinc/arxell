import type { ToolPanelId } from "../../store/toolPanelStore";
import { getHostedPanel } from "../../core/tooling/registry";

export function getPanelComponent(panelId: ToolPanelId): React.ComponentType | null {
  return getHostedPanel(panelId);
}
