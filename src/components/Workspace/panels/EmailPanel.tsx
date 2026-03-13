import { Mail, Plus, RefreshCcw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import { useEmailStore, type EmailFolder, type EmailProvider, type EmailSecurity } from "../../../store/emailStore";
import { PanelWrapper } from "./shared";

const PAGE_SIZE = 10;

export function EmailPanel() {
  const {
    accounts,
    messages,
    addAccount,
    updateAccount,
    removeAccount,
    setAccountConnected,
    pullIncoming,
    sendMessage,
    markRead,
  } = useEmailStore();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [folder, setFolder] = useState<EmailFolder>("inbox");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewAccount, setShowNewAccount] = useState(accounts.length === 0);
  const [showCompose, setShowCompose] = useState(false);

  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountProvider, setAccountProvider] = useState<EmailProvider>("custom");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSecurity, setImapSecurity] = useState<EmailSecurity>("tls");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpSecurity, setSmtpSecurity] = useState<EmailSecurity>("tls");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeStatus, setComposeStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) setSelectedAccountId(accounts[0].id);
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;

  const accountMessages = useMemo(
    () =>
      messages
        .filter((message) => message.account_id === selectedAccountId && message.folder === folder)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [folder, messages, selectedAccountId]
  );

  const totalPages = Math.max(1, Math.ceil(accountMessages.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pagedMessages = accountMessages.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const createAccount = () => {
    const name = accountName.trim();
    const email = accountEmail.trim();
    if (!name || !email) return;
    const created = addAccount({
      name,
      email,
      provider: accountProvider,
      imap_host: imapHost.trim(),
      imap_port: Number(imapPort) || 993,
      imap_security: imapSecurity,
      smtp_host: smtpHost.trim(),
      smtp_port: Number(smtpPort) || 465,
      smtp_security: smtpSecurity,
      username: username.trim(),
      password,
    });
    setSelectedAccountId(created.id);
    setShowNewAccount(false);
    setAccountName("");
    setAccountEmail("");
    setAccountProvider("custom");
    setImapHost("");
    setImapPort("993");
    setImapSecurity("tls");
    setSmtpHost("");
    setSmtpPort("465");
    setSmtpSecurity("tls");
    setUsername("");
    setPassword("");
  };

  const onPullIncoming = () => {
    if (!selectedAccountId) return;
    const count = pullIncoming(selectedAccountId);
    setComposeStatus(count > 0 ? `Synced ${count} incoming messages.` : "Connect account before syncing.");
  };

  const onSend = () => {
    if (!selectedAccountId) return;
    const sent = sendMessage(selectedAccountId, composeTo, composeSubject, composeBody);
    if (!sent) {
      setComposeStatus("Connect account before sending.");
      return;
    }
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setFolder("sent");
    setPage(1);
    setComposeStatus("Message sent.");
  };

  const hasConnectedAccount = useMemo(
    () => accounts.some((account) => account.connected),
    [accounts]
  );

  return (
    <PanelWrapper
      title="Email"
      icon={<Mail size={16} className="text-accent-primary" />}
      actions={
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewAccount((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <Plus size={12} />
            Account
          </button>
          <button
            onClick={onPullIncoming}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <RefreshCcw size={12} />
            Sync
          </button>
          <button
            onClick={() => setShowCompose((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <Send size={12} />
            Compose
          </button>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="m-3 mb-2 rounded border border-line-med bg-line-light overflow-hidden">
          <button
            onClick={() => setShowNewAccount((v) => !v)}
            className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-line-med"
          >
            <div className="text-[11px] uppercase tracking-wider text-text-dark">
              Connect Email Account
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              {hasConnectedAccount ? (
                <span className="text-accent-green/90">
                  {accounts.find((account) => account.connected)?.email ?? "Connected"}
                </span>
              ) : (
                <span className="text-text-dark">Not connected</span>
              )}
              <span className="text-text-dark">{showNewAccount ? "Hide" : "Show"}</span>
            </div>
          </button>

          {showNewAccount && (
            <div className="border-t border-line-med p-3 space-y-2">
              <div className="text-[10px] text-text-med flex flex-wrap items-center gap-1.5">
                <span>Free providers:</span>
                <a href="https://www.zoho.com/mail/" target="_blank" rel="noreferrer" className="text-accent-primary hover:text-accent-primary/80">
                  Zoho
                </a>
                <span>·</span>
                <a href="https://mail.google.com/" target="_blank" rel="noreferrer" className="text-accent-primary hover:text-accent-primary/80">
                  Gmail
                </a>
                <span>·</span>
                <a href="https://z.org/register" target="_blank" rel="noreferrer" className="text-accent-primary hover:text-accent-primary/80">
                  z.org
                </a>
                <span>·</span>
                <a href="https://proton.me/mail" target="_blank" rel="noreferrer" className="text-accent-primary hover:text-accent-primary/80">
                  Proton ($1)
                </a>
                <span>*no affiliation or guarantees</span>
              </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Display name"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <input
                type="email"
                value={accountEmail}
                onChange={(e) => setAccountEmail(e.target.value)}
                placeholder="Email address"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={accountProvider}
                onChange={(e) => setAccountProvider(e.target.value as EmailProvider)}
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              >
                <option value="custom">Custom IMAP/SMTP</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="IMAP host"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <input
                type="number"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                placeholder="IMAP port"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <select
                value={imapSecurity}
                onChange={(e) => setImapSecurity(e.target.value as EmailSecurity)}
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              >
                <option value="tls">IMAP TLS</option>
                <option value="starttls">IMAP STARTTLS</option>
                <option value="none">IMAP none</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="SMTP host"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="SMTP port"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <select
                value={smtpSecurity}
                onChange={(e) => setSmtpSecurity(e.target.value as EmailSecurity)}
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              >
                <option value="tls">SMTP TLS</option>
                <option value="starttls">SMTP STARTTLS</option>
                <option value="none">SMTP none</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password / app password"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
            </div>
            <button
              onClick={createAccount}
              className="px-2 py-1 rounded text-[11px] bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 transition-colors"
            >
              Save Account
            </button>
            </div>
          )}
          </div>

        <div className="flex-1 min-h-0 flex border-t border-line-light">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-3 py-2 border-b border-line-light flex items-center gap-2">
              <select
                value={selectedAccountId ?? ""}
                onChange={(e) => setSelectedAccountId(e.target.value || null)}
                className="min-w-[200px] px-2 py-1 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              >
                {accounts.length === 0 ? <option value="">No accounts</option> : null}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.email})
                  </option>
                ))}
              </select>
              <button
                onClick={() => selectedAccount && setAccountConnected(selectedAccount.id, !selectedAccount.connected)}
                disabled={!selectedAccount}
                className={cn(
                  "px-2 py-1 rounded text-[11px] transition-colors",
                  selectedAccount?.connected
                    ? "bg-accent-green/20 text-accent-green hover:bg-accent-green/30"
                    : "bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark"
                )}
              >
                {selectedAccount?.connected ? "Connected" : "Connect"}
              </button>
              {selectedAccount && (
                <button
                  onClick={() => {
                    removeAccount(selectedAccount.id);
                    setSelectedAccountId(null);
                  }}
                  className="px-2 py-1 rounded text-[11px] bg-accent-red/12 text-accent-red hover:bg-accent-red/20 transition-colors"
                >
                  Remove
                </button>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => {
                    setFolder("inbox");
                    setPage(1);
                  }}
                  className={cn(
                    "px-2 py-1 rounded text-[10px] uppercase",
                    folder === "inbox" ? "bg-accent-primary/20 text-accent-primary" : "bg-line-light text-text-dark"
                  )}
                >
                  Inbox
                </button>
                <button
                  onClick={() => {
                    setFolder("sent");
                    setPage(1);
                  }}
                  className={cn(
                    "px-2 py-1 rounded text-[10px] uppercase",
                    folder === "sent" ? "bg-accent-primary/20 text-accent-primary" : "bg-line-light text-text-dark"
                  )}
                >
                  Sent
                </button>
              </div>
            </div>

            <div className="border-b border-line-light grid grid-cols-[140px_200px_minmax(0,1fr)] px-3 py-2 text-[10px] uppercase tracking-wider text-text-dark">
              <div>Date</div>
              <div>{folder === "inbox" ? "From" : "To"}</div>
              <div>Subject</div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {pagedMessages.length === 0 ? (
                <div className="p-4 text-xs text-text-dark italic">No messages in this folder.</div>
              ) : (
                pagedMessages.map((message) => (
                  <div key={message.id} className="border-b border-line-light">
                    <button
                      onClick={() => {
                        setExpandedId((id) => (id === message.id ? null : message.id));
                        if (!message.read && folder === "inbox") markRead(message.id, true);
                      }}
                      className={cn(
                        "w-full grid grid-cols-[140px_200px_minmax(0,1fr)] px-3 py-2 text-left hover:bg-line-light transition-colors",
                        !message.read && folder === "inbox" && "bg-accent-primary/6"
                      )}
                    >
                      <div className="text-[11px] text-text-dark">{new Date(message.date).toLocaleString()}</div>
                      <div className="text-[11px] text-text-med truncate">{folder === "inbox" ? message.from : message.to}</div>
                      <div className={cn("text-[11px] truncate", !message.read && folder === "inbox" ? "text-text-norm" : "text-text-med")}>
                        {message.subject || "(no subject)"}
                      </div>
                    </button>
                    {expandedId === message.id && (
                      <div className="px-3 pb-3">
                        <pre className="whitespace-pre-wrap rounded bg-black/25 p-2 text-[11px] leading-5 text-text-med font-sans">
                          {message.body || "(empty message)"}
                        </pre>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-line-light px-3 py-2 flex items-center justify-between text-[11px] text-text-med">
              <span>
                Page {pageSafe} / {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe <= 1}
                  className="px-2 py-1 rounded bg-line-med disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe >= totalPages}
                  className="px-2 py-1 rounded bg-line-med disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="w-[320px] flex-shrink-0 border-l border-line-light p-3 space-y-2 overflow-y-auto">
            {selectedAccount ? (
              <>
                <div className="text-[11px] uppercase tracking-wider text-text-dark">Account Settings</div>
                <input
                  type="text"
                  value={selectedAccount.name}
                  onChange={(e) => updateAccount(selectedAccount.id, { name: e.target.value })}
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <input
                  type="text"
                  value={selectedAccount.imap_host}
                  onChange={(e) => updateAccount(selectedAccount.id, { imap_host: e.target.value })}
                  placeholder="IMAP host"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <input
                  type="text"
                  value={selectedAccount.smtp_host}
                  onChange={(e) => updateAccount(selectedAccount.id, { smtp_host: e.target.value })}
                  placeholder="SMTP host"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <div className="text-[10px] text-text-dark">
                  Last sync: {selectedAccount.last_sync_at ? new Date(selectedAccount.last_sync_at).toLocaleString() : "Never"}
                </div>
              </>
            ) : (
              <div className="text-[11px] text-text-dark italic">Create or select an account.</div>
            )}

            {showCompose && (
              <div className="mt-3 border-t border-line-med pt-3 space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-text-dark">Compose</div>
                <input
                  type="text"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="To"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <input
                  type="text"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Text-only message body"
                  className="w-full min-h-32 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50 resize-y"
                />
                <button
                  onClick={onSend}
                  className="px-2 py-1 rounded text-[11px] bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 transition-colors"
                >
                  Send
                </button>
              </div>
            )}

            {composeStatus && (
              <div className="text-[10px] text-accent-green/90">{composeStatus}</div>
            )}
          </div>
        </div>
      </div>
    </PanelWrapper>
  );
}
