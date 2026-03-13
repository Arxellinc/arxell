import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type EmailFolder = "inbox" | "sent";
export type EmailProvider = "custom";
export type EmailSecurity = "none" | "starttls" | "tls";

export interface EmailAccount {
  id: string;
  name: string;
  email: string;
  provider: EmailProvider;
  imap_host: string;
  imap_port: number;
  imap_security: EmailSecurity;
  smtp_host: string;
  smtp_port: number;
  smtp_security: EmailSecurity;
  username: string;
  password: string;
  connected: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
}

export interface EmailMessage {
  id: string;
  account_id: string;
  folder: EmailFolder;
  date: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  read: boolean;
}

interface EmailState {
  accounts: EmailAccount[];
  messages: EmailMessage[];
  addAccount: (account: Omit<EmailAccount, "id" | "created_at" | "updated_at" | "last_sync_at" | "connected">) => EmailAccount;
  updateAccount: (
    id: string,
    patch: Partial<
      Pick<
        EmailAccount,
        | "name"
        | "email"
        | "provider"
        | "imap_host"
        | "imap_port"
        | "imap_security"
        | "smtp_host"
        | "smtp_port"
        | "smtp_security"
        | "username"
        | "password"
      >
    >
  ) => void;
  removeAccount: (id: string) => void;
  setAccountConnected: (id: string, connected: boolean) => void;
  pullIncoming: (accountId: string) => number;
  sendMessage: (accountId: string, to: string, subject: string, body: string) => EmailMessage | null;
  markRead: (messageId: string, read: boolean) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

function sampleIncoming(account: EmailAccount, index: number): EmailMessage {
  const senders = ["ops@alerts.local", "teammate@workspace.dev", "noreply@updates.example"];
  const sender = senders[index % senders.length];
  return {
    id: makeId("msg"),
    account_id: account.id,
    folder: "inbox",
    date: nowIso(),
    from: sender,
    to: account.email,
    subject: `New message ${index + 1} for ${account.name}`,
    body: [
      `From: ${sender}`,
      `To: ${account.email}`,
      "",
      "This is a text-only incoming email synced by the local email tool.",
      "Use this panel to read, paginate, and manage messages.",
    ].join("\n"),
    read: false,
  };
}

const EMAIL_STORE_VERSION = 1;

export const useEmailStore = create<EmailState>()(
  persist(
    (set) => ({
      accounts: [],
      messages: [],

      addAccount: (account) => {
        const normalized = { ...account, provider: "custom" as EmailProvider };
        const created: EmailAccount = {
          ...normalized,
          id: makeId("acct"),
          connected: false,
          created_at: nowIso(),
          updated_at: nowIso(),
          last_sync_at: null,
        };
        set((state) => ({ accounts: [created, ...state.accounts] }));
        return created;
      },

      updateAccount: (id, patch) =>
        set((state) => ({
          accounts: state.accounts.map((account) =>
            account.id === id
              ? {
                  ...account,
                  ...patch,
                  updated_at: nowIso(),
                }
              : account
          ),
        })),

      removeAccount: (id) =>
        set((state) => ({
          accounts: state.accounts.filter((account) => account.id !== id),
          messages: state.messages.filter((message) => message.account_id !== id),
        })),

      setAccountConnected: (id, connected) =>
        set((state) => ({
          accounts: state.accounts.map((account) =>
            account.id === id
              ? {
                  ...account,
                  connected,
                  updated_at: nowIso(),
                  last_sync_at: connected ? nowIso() : account.last_sync_at,
                }
              : account
          ),
        })),

      pullIncoming: (accountId) => {
        let createdCount = 0;
        set((state) => {
          const account = state.accounts.find((item) => item.id === accountId);
          if (!account || !account.connected) return state;
          const incoming = Array.from({ length: 3 }, (_, idx) => sampleIncoming(account, idx));
          createdCount = incoming.length;
          return {
            messages: [...incoming, ...state.messages],
            accounts: state.accounts.map((item) =>
              item.id === accountId ? { ...item, last_sync_at: nowIso(), updated_at: nowIso() } : item
            ),
          };
        });
        return createdCount;
      },

      sendMessage: (accountId, to, subject, body) => {
        let sent: EmailMessage | null = null;
        set((state) => {
          const account = state.accounts.find((item) => item.id === accountId);
          if (!account || !account.connected) return state;
          sent = {
            id: makeId("msg"),
            account_id: accountId,
            folder: "sent",
            date: nowIso(),
            from: account.email,
            to: to.trim(),
            subject: subject.trim() || "(no subject)",
            body: body.trim(),
            read: true,
          };
          return {
            messages: [sent, ...state.messages],
            accounts: state.accounts.map((item) =>
              item.id === accountId ? { ...item, updated_at: nowIso() } : item
            ),
          };
        });
        return sent;
      },

      markRead: (messageId, read) =>
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === messageId ? { ...message, read } : message
          ),
        })),
    }),
    {
      name: "arx-email-store",
      version: EMAIL_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accounts: state.accounts,
        messages: state.messages,
      }),
    }
  )
);
