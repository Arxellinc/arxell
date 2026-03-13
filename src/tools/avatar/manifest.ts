import { SquareUser } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { AvatarPanel } from "../../components/Workspace/panels/AvatarPanel";

export const avatarToolManifest: ToolManifest = {
  id: "avatar",
  version: "1.0.0",
  title: "Avatar",
  description: "Real-time animated voice avatar",
  iconName: "SquareUser",
  icon: SquareUser,
  category: "main",
  panel: AvatarPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {},
};
