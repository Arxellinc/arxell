export type ChatTtsQueueItem = {
  text: string;
  correlationId: string | null;
};

interface ChatTtsPipelineOptions {
  minSentenceChars: number;
  firstChunkTarget: number;
  steadyChunkTarget: number;
  minFlushChars: number;
  flushIntervalMs: number;
}

export class ChatTtsPipeline {
  private readonly options: ChatTtsPipelineOptions;
  private queue: ChatTtsQueueItem[] = [];
  private queueWaiters: Array<() => void> = [];
  private activeCorrelationId: string | null = null;
  private streamBuffer = "";
  private pendingTicks = "";
  private inInlineCode = false;
  private inFencedCode = false;
  private flushTimerId: number | null = null;
  private textStatsByCorrelation = new Map<string, { streamChars: number; enqueuedChars: number }>();

  constructor(options: ChatTtsPipelineOptions) {
    this.options = options;
  }

  queueLength(): number { return this.queue.length; }
  getActiveCorrelationId(): string | null { return this.activeCorrelationId; }

  resetStreamParser(correlationId: string | null): void {
    this.clearFlushTimer();
    this.activeCorrelationId = correlationId;
    this.streamBuffer = "";
    this.pendingTicks = "";
    this.inInlineCode = false;
    this.inFencedCode = false;
  }

  resetQueue(): void {
    this.clearFlushTimer();
    this.queue = [];
    this.notifyQueueAvailable();
    this.resetStreamParser(null);
  }

  enqueueImmediate(text: string, correlationId: string | null): void {
    if (!text.trim()) return;
    this.queue.push({ text, correlationId });
    this.notifyQueueAvailable();
  }

  noteStreamChars(correlationId: string, deltaLength: number): void {
    const existing = this.textStatsByCorrelation.get(correlationId) ?? { streamChars: 0, enqueuedChars: 0 };
    existing.streamChars += deltaLength;
    this.textStatsByCorrelation.set(correlationId, existing);
  }

  consumeTextStats(correlationId: string): { streamChars: number; enqueuedChars: number } | null {
    const stats = this.textStatsByCorrelation.get(correlationId) ?? null;
    if (stats) this.textStatsByCorrelation.delete(correlationId);
    return stats;
  }

  extractSpeakableStreamDelta(delta: string): string {
    if (!delta) return "";
    let input = `${this.pendingTicks}${delta}`;
    this.pendingTicks = "";
    let output = "";
    let index = 0;
    while (index < input.length) {
      const char = input[index];
      if (char !== "`") {
        if (!this.inInlineCode && !this.inFencedCode) output += char;
        index += 1;
        continue;
      }
      let run = 1;
      while (index + run < input.length && input[index + run] === "`") run += 1;
      const atEnd = index + run >= input.length;
      if (atEnd && !this.inInlineCode && !this.inFencedCode && run < 3) {
        this.pendingTicks = "`".repeat(run);
        break;
      }
      if (this.inFencedCode) {
        if (run >= 3) this.inFencedCode = false;
        index += run;
        continue;
      }
      if (this.inInlineCode) {
        this.inInlineCode = false;
        index += run;
        continue;
      }
      if (run >= 3) {
        this.inFencedCode = true;
        index += run;
        continue;
      }
      this.inInlineCode = true;
      index += run;
    }
    return output;
  }

  enqueueSpeakableChunk(
    rawChunk: string,
    finalFlush: boolean,
    correlationId: string | null,
    backlogActive: boolean,
    postprocess: (raw: string) => string,
    fallback: (raw: string) => string,
  ): void {
    if (!rawChunk && !finalFlush) return;
    this.streamBuffer += rawChunk;
    while (this.streamBuffer.length > 0) {
      const boundary = this.nextSpeakableBoundary(this.streamBuffer, finalFlush, backlogActive);
      if (boundary < 0) break;
      const part = this.streamBuffer.slice(0, boundary);
      let speakable = postprocess(part);
      if (!speakable && /[A-Za-z0-9]/.test(part)) {
        speakable = fallback(part);
      }
      if (speakable) {
        this.streamBuffer = this.streamBuffer.slice(boundary);
        this.queue.push({ text: speakable, correlationId });
        if (correlationId) {
          const stats = this.textStatsByCorrelation.get(correlationId) ?? { streamChars: 0, enqueuedChars: 0 };
          stats.enqueuedChars += speakable.length;
          this.textStatsByCorrelation.set(correlationId, stats);
        }
        this.notifyQueueAvailable();
      } else if (!finalFlush) {
        break;
      } else {
        this.streamBuffer = this.streamBuffer.slice(boundary);
      }
      if (finalFlush && !this.streamBuffer.trim()) {
        this.streamBuffer = "";
        break;
      }
    }
  }

  tryLowLatencyBufferFlush(
    backlogActive: boolean,
    postprocess: (raw: string) => string,
    fallback: (raw: string) => string,
  ): boolean {
    if (!this.streamBuffer.trim()) return false;
    const candidate = postprocess(this.streamBuffer);
    if (candidate.length < this.options.minFlushChars) return false;
    const target = backlogActive ? this.options.steadyChunkTarget : this.options.firstChunkTarget;
    const boundary = this.findSafeWordBoundary(this.streamBuffer, Math.min(this.streamBuffer.length, target), 55);
    if (boundary < 55) return false;
    const part = this.streamBuffer.slice(0, boundary);
    let speakable = postprocess(part);
    if (!speakable && /[A-Za-z0-9]/.test(part)) speakable = fallback(part);
    if (!speakable) return false;
    this.streamBuffer = this.streamBuffer.slice(boundary);
    this.queue.push({ text: speakable, correlationId: this.activeCorrelationId });
    this.notifyQueueAvailable();
    return true;
  }

  scheduleLowLatencyBufferFlush(
    enabled: boolean,
    onFlushAttempt: () => boolean,
    onQueueWork: () => void,
  ): void {
    if (this.flushTimerId !== null || !enabled) return;
    if (!this.streamBuffer.trim()) return;
    this.flushTimerId = window.setTimeout(() => {
      this.flushTimerId = null;
      if (!enabled) return;
      const flushed = onFlushAttempt();
      if (flushed) onQueueWork();
      if (this.streamBuffer.trim()) {
        this.scheduleLowLatencyBufferFlush(enabled, onFlushAttempt, onQueueWork);
      }
    }, this.options.flushIntervalMs);
  }

  async waitForQueueText(
    timeoutMs: number,
    mergeTarget: number,
    firstChunkTarget: number
  ): Promise<ChatTtsQueueItem | null> {
    const immediate = this.shiftQueueText(mergeTarget, firstChunkTarget);
    if (immediate) return immediate;
    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.queueWaiters = this.queueWaiters.filter((waiter) => waiter !== onReady);
        resolve();
      }, timeoutMs);
      const onReady = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      this.queueWaiters.push(onReady);
    });
    return this.shiftQueueText(mergeTarget, firstChunkTarget);
  }

  takeQueueTextNow(mergeTarget: number, firstChunkTarget: number): ChatTtsQueueItem | null {
    return this.shiftQueueText(mergeTarget, firstChunkTarget);
  }

  private clearFlushTimer(): void {
    if (this.flushTimerId === null) return;
    window.clearTimeout(this.flushTimerId);
    this.flushTimerId = null;
  }

  private notifyQueueAvailable(): void {
    if (!this.queueWaiters.length) return;
    const waiters = this.queueWaiters.slice();
    this.queueWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private nextSpeakableBoundary(text: string, finalFlush: boolean, backlogActive: boolean): number {
    if (!text.trim().length) return -1;
    let boundary = -1;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "." || ch === "!" || ch === "?" || ch === "\n") boundary = i;
    }
    if (boundary >= 0 && boundary + 1 >= this.options.minSentenceChars) return boundary + 1;
    const eagerTarget = backlogActive ? this.options.steadyChunkTarget : this.options.firstChunkTarget;
    if (!backlogActive && text.length >= 40) {
      const softSplit = this.findSafeWordBoundary(text, Math.min(text.length, 80), 25);
      if (softSplit >= 25) return softSplit;
    }
    if (text.length >= eagerTarget) {
      const split = this.findSafeWordBoundary(text, eagerTarget - 4, 25);
      if (split >= 25) return split;
      if (finalFlush) return text.length;
      return -1;
    }
    if (finalFlush) return text.length;
    return -1;
  }

  private findSafeWordBoundary(text: string, target: number, minIndex = 0): number {
    const clampedTarget = Math.max(minIndex, Math.min(target, text.length));
    if (!text.length) return -1;
    const isBoundary = (ch: string): boolean =>
      ch === " " || ch === "\n" || ch === "\t" || ch === "." || ch === "!" || ch === "?";
    for (let i = clampedTarget; i >= minIndex; i -= 1) {
      const ch = text[i - 1] ?? "";
      if (isBoundary(ch)) return i;
    }
    for (let i = clampedTarget; i < text.length; i += 1) {
      const ch = text[i] ?? "";
      if (isBoundary(ch)) return i + 1;
    }
    return -1;
  }

  private shiftQueueText(mergeTarget: number, firstChunkTarget: number): ChatTtsQueueItem | null {
    const next = this.queue.shift();
    if (!next || !next.text.trim()) return null;
    let merged = next.text.trim();
    const correlationId = next.correlationId;
    while (this.queue.length > 0 && merged.length < mergeTarget) {
      const peek = this.queue[0];
      if (!peek || !peek.text.trim()) {
        this.queue.shift();
        continue;
      }
      if (peek.correlationId !== correlationId) break;
      if (/[.!?]\s*$/.test(merged) && merged.length >= firstChunkTarget) break;
      const tail = this.queue.shift();
      if (!tail) break;
      merged = `${merged} ${tail.text}`.replace(/\s+/g, " ").trim();
    }
    return merged ? { text: merged, correlationId } : null;
  }
}
