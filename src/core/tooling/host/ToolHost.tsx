import type { MouseEvent } from "react";
import { getHostedPanel, getToolManifest } from "../registry";
import type { ToolPanelId } from "../types";
import { ContextPayloadDrawer } from "./ContextPayloadDrawer";
import { suppressContextMenuUnlessAllowed } from "../../../lib/contextMenu";

interface ToolHostProps {
  panelId: ToolPanelId;
}

export function ToolHost({ panelId }: ToolHostProps) {
  const PanelComponent = getHostedPanel(panelId);
  if (!PanelComponent) return null;
  const manifest = getToolManifest(panelId);
  const allowNativeContextMenu = manifest?.allowNativeContextMenu === true;

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (allowNativeContextMenu) return;
    suppressContextMenuUnlessAllowed(event);
  };

  return (
    <div className="absolute inset-0" onContextMenu={handleContextMenu}>
      <PanelComponent />
      <ContextPayloadDrawer panelId={panelId} />
    </div>
  );
}
