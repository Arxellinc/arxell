import { Mail } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { EmailPanel } from "../../components/Workspace/panels/EmailPanel";

export const emailToolManifest: ToolManifest = {
  id: "email",
  version: "1.0.0",
  title: "Email",
  description: "Text-only IMAP/SMTP inbox and composer",
  iconName: "Mail",
  icon: Mail,
  category: "main",
  panel: EmailPanel,
  defaultEnabled: false,
  core: false,
  allowedModes: ["sandbox", "shell"],
  defaultMode: "sandbox",
  capabilities: {
    net: { hosts: [] },
  },
};
