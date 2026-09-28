/**
 * Agents right-panel surface: the fleet view over the native subagent fold.
 * The chat carries one expandable row per spawn batch and links here.
 *
 * Visualization rules (from live-test feedback):
 * - Spawn order is stable. Activity and completion update rows in place.
 * - Agent rows reserve three fixed lines for identity, activity, and metrics;
 *   changing data must never change their height.
 * - Workflow expansion is presentation state. A live run stays expanded when
 *   it settles; older collapsed runs can still be opened at run granularity.
 * - Static status dots, DOM-write elapsed timers, plain token counters.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  AgentPanelModel,
  AgentPanelWorkflowGroup,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  formatSubagentModelLabel,
  formatSubagentTokenCount,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  EnvironmentId,
  ProviderSubagentTranscriptBlock,
  ProviderSubagentTranscriptMessage,
  ThreadId,
} from "@t3tools/contracts";
import { Bot, Braces, Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import ChatMarkdown from "~/components/ChatMarkdown";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

/**
 * In-flight states all present as Working (one steady state, per the
 * monitoring-pill design: detail belongs in the activity sub-line, and a
 * stalled/waiting/queued subagent is still the fleet doing its job, not a
 * user problem). Only settled states differentiate.
 */
const STATUS_VISUALS: Record<RuntimeSubagent["status"], { dotClass: string; label: string }> = {
  pending: { dotClass: "bg-info", label: "Working" },
  running: { dotClass: "bg-info", label: "Working" },
  waiting: { dotClass: "bg-info", label: "Working" },
  // Idle reads as settled (muted, not sky): a resting Codex child looks done
  // unless resumed — live-test: sky idle dots read as stuck in-progress.
  idle: { dotClass: "bg-muted-foreground/50", label: "Idle · resumable" },
  completed: { dotClass: "bg-success", label: "Completed" },
  failed: { dotClass: "bg-destructive", label: "Failed" },
  cancelled: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
  interrupted: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
};

function StatusDot({ status }: { status: RuntimeSubagent["status"] }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_VISUALS[status].dotClass)}
    />
  );
}

function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function elapsedBetween(startedAt: string, endIso: string | null): string {
  const start = Date.parse(startedAt);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "";
  }
  return formatElapsedSeconds((end - start) / 1000);
}

/**
 * Elapsed time for the current activation. Live agents self-tick via DOM
 * writes (zero React commits per tick); settled agents freeze at completedAt.
 */
function AgentElapsed({ agent }: { agent: RuntimeSubagent }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const live = agent.status === "running" || agent.status === "waiting";
  const startedAt = agent.startedAt;

  useEffect(() => {
    if (!live || !startedAt) {
      return;
    }
    const update = () => {
      if (textRef.current) {
        textRef.current.textContent = elapsedBetween(startedAt, null);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [live, startedAt]);

  if (!startedAt) {
    return null;
  }
  return (
    <span ref={textRef} className="tabular-nums">
      {elapsedBetween(startedAt, live ? null : agent.completedAt)}
    </span>
  );
}

/**
 * Status-dependent activity line. Live rows lead with what is happening now;
 * settled rows lead with the outcome. Errors are the only inline previews on
 * failed rows because they explain a red row at a glance.
 */
function agentActivityText(agent: RuntimeSubagent): string | null {
  const live =
    agent.status === "running" || agent.status === "pending" || agent.status === "waiting";
  if (live) {
    return (
      agent.progress ??
      (agent.lastToolName ? `▸ ${agent.lastToolName}` : null) ??
      agent.result ??
      agent.error
    );
  }
  return (
    agent.error ??
    agent.result ??
    agent.progress ??
    (agent.lastToolName ? `▸ ${agent.lastToolName}` : null)
  );
}

/** Fixed-height agent status line. Selecting it opens the agent detail view. */
function AgentRow({
  agent,
  onSelect,
}: {
  agent: RuntimeSubagent;
  onSelect: (agentId: string) => void;
}) {
  const visuals = STATUS_VISUALS[agent.status];
  const statusLabel =
    agent.kind === "subagent_batch" && agent.status === "idle" ? "Idle" : visuals.label;
  const activity = agentActivityText(agent);
  const modelLabel = formatSubagentModelLabel(agent.model, agent.effort);
  const role =
    agent.role?.trim().toLocaleLowerCase() === agent.title.trim().toLocaleLowerCase()
      ? null
      : agent.role;
  const metadata = [
    modelLabel,
    agent.usage ? `${formatSubagentTokenCount(agent.usage.totalTokens)} tok` : "— tok",
    agent.usage?.toolUses !== undefined ? `${agent.usage.toolUses} tools` : null,
    agent.activationCount > 1 ? `run ${agent.activationCount}` : null,
  ].filter((value): value is string => value !== null);

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className="grid h-[3.875rem] w-full grid-cols-[0.375rem_minmax(0,1fr)_auto] grid-rows-[1.25rem_1.125rem_1rem] items-center gap-x-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/40"
    >
      <span className="col-start-1 row-start-1 flex items-center">
        <StatusDot status={agent.status} />
      </span>
      <span className="col-start-2 row-start-1 flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{agent.title}</span>
        {role ? (
          <span className="max-w-28 shrink-0 truncate rounded-sm border border-border/60 px-1 font-mono text-3xs text-muted-foreground">
            {role}
          </span>
        ) : null}
      </span>
      <span className="col-start-3 row-start-1 min-w-14 text-right font-mono text-2xs text-muted-foreground/80">
        <span className="inline-flex items-center gap-1">
          <AgentElapsed agent={agent} />
          {agent.status === "completed" ? (
            <Check aria-hidden className="size-3 text-success" />
          ) : null}
        </span>
      </span>
      <span
        className={cn(
          "col-start-2 col-end-4 row-start-2 block truncate text-xs",
          agent.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      >
        {activity ?? statusLabel}
      </span>
      <span className="col-start-2 col-end-4 row-start-3 truncate font-mono text-2xs tabular-nums text-muted-foreground/70">
        {metadata.join(" · ")}
      </span>
      <span className="sr-only">{statusLabel}</span>
    </button>
  );
}

function workflowIsLive(group: AgentPanelWorkflowGroup): boolean {
  const status = group.workflow.status;
  return (
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "interrupted"
  );
}

function workflowMembers(group: AgentPanelWorkflowGroup): ReadonlyArray<RuntimeSubagent> {
  return [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
}

/**
 * Phase rail: the run's shape at a glance. One segment per phase in order,
 * separated by chevrons; each segment shows title + one dot per member.
 * The whole arc (done → live → pending) is visible without scrolling the
 * member list.
 */
function PhaseRail({ group }: { group: AgentPanelWorkflowGroup }) {
  if (group.phases.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1.5 pb-1 pt-1.5">
      {group.phases.map((phase, index) => (
        <div key={phase.index} className="flex items-center gap-1">
          {index > 0 ? (
            <ChevronRight aria-hidden className="size-3 text-muted-foreground/40" />
          ) : null}
          <div
            className={cn(
              "flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
              phase.state === "running"
                ? "border-info/40"
                : phase.state === "done"
                  ? "border-success/30"
                  : "border-border/50",
            )}
          >
            <span
              className={cn(
                "font-mono text-3xs",
                phase.state === "running"
                  ? "text-info-foreground"
                  : phase.state === "done"
                    ? "text-success-foreground"
                    : "text-muted-foreground/70",
              )}
            >
              {phase.state === "done" ? "✓ " : ""}
              {phase.title}
            </span>
            <span className="flex items-center gap-0.5">
              {phase.members.length === 0 ? (
                <span className="font-mono text-3xs text-muted-foreground/50">–</span>
              ) : (
                phase.members.map((member) => <StatusDot key={member.id} status={member.status} />)
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only workflow script viewer, fetched through the contained
 * getWorkflowScript RPC (never a raw filesystem read from the client).
 */
function WorkflowScriptView({
  environmentId,
  threadId,
  scriptPath,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  scriptPath: string;
  onClose: () => void;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.workflowScript({ environmentId, input: { threadId, scriptPath } }),
  );
  return (
    <div className="mx-1.5 mb-1 rounded-md border border-border/60 bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1">
        <Braces aria-hidden className="size-3 text-muted-foreground" />
        <span className="truncate font-mono text-3xs text-muted-foreground">
          {scriptPath.split("/").at(-1)}
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onClose}
          aria-label="Close script"
          className="ml-auto"
        >
          <X aria-hidden className="size-3" />
        </Button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {result._tag === "Success" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-foreground/90">
            {result.value.contents}
            {result.value.truncated ? "\n… (truncated)" : ""}
          </pre>
        ) : result._tag === "Failure" ? (
          <p className="text-xs text-destructive-foreground">Could not load the script.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible phase section. A phase opens when it becomes active, then keeps
 * that shape as it settles so completion never yanks rows out from under the
 * user. Manual toggles stick until a later activation begins.
 */
function PhaseSection({
  phase,
  onSelectAgent,
  defaultOpen = false,
}: {
  phase: AgentPanelWorkflowGroup["phases"][number];
  onSelectAgent: (agentId: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || phase.state === "running");
  const previousState = useRef(phase.state);

  useEffect(() => {
    if (previousState.current !== "running" && phase.state === "running") {
      setOpen(true);
    }
    previousState.current = phase.state;
  }, [phase.state]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "mt-2 flex w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-3xs font-medium uppercase tracking-wider hover:bg-accent/40",
          phase.state === "done"
            ? "text-success-foreground"
            : phase.state === "running"
              ? "text-info-foreground"
              : "text-muted-foreground/70",
        )}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0" />
        )}
        {phase.state === "done" ? <Check aria-hidden className="size-3" /> : null}
        <span>{phase.title}</span>
        <span className="font-normal normal-case text-muted-foreground/70">
          {phase.state === "pending" && phase.members.length === 0
            ? "pending"
            : phase.state === "done"
              ? `${phase.settledCount} done`
              : `${phase.activeCount} active · ${phase.settledCount} done`}
        </span>
        {!open && phase.members.length > 0 ? (
          <span className="ml-auto flex items-center gap-0.5">
            {phase.members.map((member) => (
              <StatusDot key={member.id} status={member.status} />
            ))}
          </span>
        ) : null}
      </button>
      {open
        ? phase.members.map((member) => (
            <AgentRow key={member.id} agent={member} onSelect={onSelectAgent} />
          ))
        : null}
    </div>
  );
}

/** Expanded workflow: phase rail + full phase tree. */
function ExpandedWorkflowSection({
  group,
  environmentId,
  threadId,
  onSelectAgent,
  onCollapse,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onSelectAgent: (agentId: string) => void;
  onCollapse: () => void;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const members = workflowMembers(group);
  const settled = members.filter(
    (member) =>
      member.status === "completed" ||
      member.status === "failed" ||
      member.status === "cancelled" ||
      member.status === "interrupted",
  ).length;
  const scriptPath = group.workflow.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  return (
    <section className="rounded-lg border border-border/50 bg-card/30 p-1.5">
      <div className="flex items-center gap-2 px-1.5 pt-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        <StatusDot status={group.workflow.status} />
        <span className="min-w-0 truncate">
          {group.workflow.workflowName ?? group.workflow.title}
        </span>
        {canShowScript ? (
          <button
            type="button"
            onClick={() => setScriptOpen((value) => !value)}
            className={cn(
              "rounded-sm border border-border/60 px-1 font-mono normal-case hover:text-foreground",
              scriptOpen && "text-foreground",
            )}
            aria-expanded={scriptOpen}
          >
            {"{}"} script
          </button>
        ) : null}
        <span className="ml-auto font-mono normal-case text-muted-foreground/80">
          {settled}/{members.length} settled
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onCollapse}
          aria-label="Collapse workflow"
        >
          <ChevronDown aria-hidden className="size-3" />
        </Button>
      </div>
      <PhaseRail group={group} />
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {group.phases.map((phase) => (
        <PhaseSection
          key={phase.index}
          phase={phase}
          onSelectAgent={onSelectAgent}
          defaultOpen={!workflowIsLive(group)}
        />
      ))}
      {group.unphasedMembers.map((member) => (
        <AgentRow key={member.id} agent={member} onSelect={onSelectAgent} />
      ))}
      {group.phases.length === 0 && group.unphasedMembers.length === 0 ? (
        <AgentRow agent={group.workflow} onSelect={onSelectAgent} />
      ) : null}
    </section>
  );
}

/**
 * Collapsed workflow: one summary line. The parent owns expansion so a live
 * workflow keeps its shape when it settles.
 */
function CollapsedWorkflowSection({
  group,
  onExpand,
}: {
  group: AgentPanelWorkflowGroup;
  onExpand: () => void;
}) {
  const members = workflowMembers(group);
  const failed = members.filter((member) => member.status === "failed").length;
  // Coordinator usage may already aggregate members (panel-footer rule):
  // count it only when there are no member rows to sum.
  const totalTokens = members.reduce(
    (sum, member) => sum + (member.usage?.totalTokens ?? 0),
    members.length === 0 ? (group.workflow.usage?.totalTokens ?? 0) : 0,
  );
  const elapsed =
    group.workflow.startedAt && group.workflow.completedAt
      ? elapsedBetween(group.workflow.startedAt, group.workflow.completedAt)
      : null;
  return (
    <section>
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/40"
        aria-expanded={false}
      >
        <StatusDot status={failed > 0 ? "failed" : group.workflow.status} />
        <span className="truncate text-sm">
          {group.workflow.workflowName ?? group.workflow.title}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-2xs text-muted-foreground/80">
          {failed > 0 ? <span className="text-destructive-foreground">{failed} failed</span> : null}
          <span>{members.length} agents</span>
          <span className="tabular-nums">· {formatSubagentTokenCount(totalTokens)} tok</span>
          {elapsed ? <span className="tabular-nums">· {elapsed}</span> : null}
          <ChevronRight aria-hidden className="size-3" />
        </span>
      </button>
    </section>
  );
}

/** A workflow's open state is presentation state, not a status derivative. */
function WorkflowSection({
  group,
  environmentId,
  threadId,
  onSelectAgent,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onSelectAgent: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(() => workflowIsLive(group));
  return open ? (
    <ExpandedWorkflowSection
      group={group}
      environmentId={environmentId}
      threadId={threadId}
      onSelectAgent={onSelectAgent}
      onCollapse={() => setOpen(false)}
    />
  ) : (
    <CollapsedWorkflowSection group={group} onExpand={() => setOpen(true)} />
  );
}

/** One-line, single-space-collapsed preview of arbitrary tool input/output. */
function truncateOneLine(text: string, maxLength: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}

/**
 * Collapsed by default: standard tool metadata (name + a one-line preview) on
 * the header row, full detail only once expanded — matches the main
 * timeline's tool-call rows instead of dumping raw JSON/output inline.
 */
function CollapsibleTranscriptBlock({
  summary,
  isError = false,
  children,
}: {
  summary: string;
  isError?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-mono text-2xs transition-colors hover:bg-accent/20",
          isError ? "text-destructive" : "text-foreground/90",
        )}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>
      {open ? <div className="mt-1 rounded-md bg-muted/40 px-3 py-2">{children}</div> : null}
    </div>
  );
}

type ToolUseBlock = Extract<ProviderSubagentTranscriptBlock, { type: "tool_use" }>;
type ToolResultBlock = Extract<ProviderSubagentTranscriptBlock, { type: "tool_result" }>;

/** A non-tool block, tagged with which message it came from (for the role label). */
interface TranscriptTextItem {
  readonly kind: "text" | "thinking";
  readonly role: "user" | "assistant";
  readonly text: string;
}

/** One tool call: its invocation and (once arrived) its result, shown as one collapsible. */
interface TranscriptToolItem {
  readonly kind: "tool";
  readonly toolUse: ToolUseBlock | null;
  readonly toolResult: ToolResultBlock | null;
}

type TranscriptRenderItem = TranscriptTextItem | TranscriptToolItem;

/**
 * Anthropic-style transcripts put a tool_use in one (assistant) message and
 * its tool_result in the next (user) message. Pairing them by id here, across
 * message boundaries, is what lets the UI show one collapsible per tool call
 * instead of two — matching how the main timeline renders tool calls.
 */
/** The SDK's final-report tool — a plain message to the caller, not a real tool call. */
const HANDBACK_TOOL_NAME = "SubagentHandback";

function handbackMessageText(input: unknown): string {
  if (input && typeof input === "object" && "message" in input) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return JSON.stringify(input);
}

function buildTranscriptRenderItems(
  messages: ReadonlyArray<ProviderSubagentTranscriptMessage>,
): ReadonlyArray<TranscriptRenderItem> {
  const items: TranscriptRenderItem[] = [];
  const pendingToolUseIndex = new Map<string, number>();
  const handbackToolUseIds = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      switch (block.type) {
        case "text":
          items.push({ kind: "text", role: message.role, text: block.text });
          break;
        case "thinking":
          items.push({ kind: "thinking", role: message.role, text: block.thinking });
          break;
        case "tool_use":
          if (block.name === HANDBACK_TOOL_NAME) {
            handbackToolUseIds.add(block.id);
            items.push({ kind: "text", role: "assistant", text: handbackMessageText(block.input) });
            break;
          }
          pendingToolUseIndex.set(block.id, items.length);
          items.push({ kind: "tool", toolUse: block, toolResult: null });
          break;
        case "tool_result": {
          if (handbackToolUseIds.delete(block.toolUseId)) break;
          const pendingIndex = pendingToolUseIndex.get(block.toolUseId);
          const pending = pendingIndex !== undefined ? items[pendingIndex] : undefined;
          if (pending?.kind === "tool") {
            items[pendingIndex!] = { ...pending, toolResult: block };
            pendingToolUseIndex.delete(block.toolUseId);
          } else {
            // No matching call in view (e.g. transcript fetched mid-run) — still show it.
            items.push({ kind: "tool", toolUse: null, toolResult: block });
          }
          break;
        }
      }
    }
  }
  return items;
}

function TranscriptTextItemView({ item }: { item: TranscriptTextItem }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        {item.role === "assistant" ? "Assistant" : "User"}
      </div>
      {item.kind === "thinking" ? (
        <div className="rounded-md border border-border/40 bg-muted/20 p-2 text-xs italic text-muted-foreground">
          {item.text}
        </div>
      ) : (
        <ChatMarkdown text={item.text} cwd={undefined} />
      )}
    </div>
  );
}

/** One collapsible per tool call: name + input preview on the header, input and result once expanded. */
function TranscriptToolItemView({ item }: { item: TranscriptToolItem }) {
  const { toolUse, toolResult } = item;
  const name = toolUse?.name ?? "tool";
  const inputPreview = toolUse ? truncateOneLine(JSON.stringify(toolUse.input), 60) : null;
  const summary = `▸ ${name}${inputPreview ? `: ${inputPreview}` : ""}`;
  const isError = toolResult?.isError ?? false;
  return (
    <CollapsibleTranscriptBlock summary={summary} isError={isError}>
      <div className="flex flex-col gap-2">
        {toolUse ? (
          <div>
            <div className="mb-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
              Input
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-3xs text-muted-foreground">
              {JSON.stringify(toolUse.input, null, 2)}
            </pre>
          </div>
        ) : null}
        {toolResult ? (
          <div>
            <div className="mb-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
              Result
            </div>
            <pre
              className={cn(
                "max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-3xs",
                isError ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {toolResult.content}
            </pre>
          </div>
        ) : (
          <p className="text-3xs italic text-muted-foreground">No result yet.</p>
        )}
      </div>
    </CollapsibleTranscriptBlock>
  );
}

/**
 * Fallback view: the same compact summary fields AgentRow already shows,
 * just given room to breathe. Used whenever a full transcript isn't
 * available — provider unsupported, fetch failed, subagent still running
 * with no file written yet, whatever. Never a dead end.
 */
function AgentSummaryFallback({ agent }: { agent: RuntimeSubagent }) {
  const activity = agentActivityText(agent);
  return (
    <div className="flex flex-col gap-2 p-1">
      <p className="text-xs text-muted-foreground">
        Full transcript isn't available for this agent. Showing the summary instead.
      </p>
      {activity ? <p className="whitespace-pre-wrap text-sm">{activity}</p> : null}
      {agent.recentActivity.length > 0 ? (
        <div className="flex flex-col gap-1">
          {agent.recentActivity.map((entry) => (
            <p
              key={entry.at}
              className="whitespace-pre-wrap font-mono text-2xs text-muted-foreground"
            >
              {entry.summary}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Fetches and renders one agent's full transcript, on demand — never preloaded. */
function AgentTranscriptBody({
  agent,
  environmentId,
  threadId,
}: {
  agent: RuntimeSubagent;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.subagentTranscript({
      environmentId,
      input: { threadId, agentId: agent.id },
    }),
  );

  if (result._tag === "Success") {
    if (result.value._tag === "available" && result.value.messages.length > 0) {
      const items = buildTranscriptRenderItems(result.value.messages);
      const lastItem = items[items.length - 1];
      const historyItems = items.slice(0, -1);
      return (
        <div className="flex flex-col gap-2">
          {historyItems.length > 0 ? (
            <CollapsibleTranscriptBlock
              summary={`Full transcript (${historyItems.length} ${historyItems.length === 1 ? "message" : "messages"})`}
            >
              <div className="flex flex-col gap-2">
                {historyItems.map((item, index) => (
                  // oxlint-disable-next-line react/no-array-index-key -- immutable fetched-once sequence, no server-issued id
                  <div key={index}>
                    {item.kind === "tool" ? (
                      <TranscriptToolItemView item={item} />
                    ) : (
                      <TranscriptTextItemView item={item} />
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleTranscriptBlock>
          ) : null}
          {lastItem ? (
            lastItem.kind === "tool" ? (
              <TranscriptToolItemView item={lastItem} />
            ) : (
              <TranscriptTextItemView item={lastItem} />
            )
          ) : null}
        </div>
      );
    }
    return <AgentSummaryFallback agent={agent} />;
  }
  if (result._tag === "Failure") {
    return <AgentSummaryFallback agent={agent} />;
  }
  return <p className="p-2 text-xs text-muted-foreground">Loading transcript…</p>;
}

/**
 * Dedicated agent detail view: a dropdown + prev/next stepper over one flat
 * agent sequence, showing only the selected agent's full transcript (falling
 * back to the existing summary when unavailable) with a stats footer. Chosen
 * over per-row inline expansion because it doesn't require threading
 * activities/pagination state through the whole panel component tree.
 */
function AgentDetailView({
  agent,
  stepAgents,
  environmentId,
  threadId,
  onSelectAgent,
}: {
  agent: RuntimeSubagent;
  stepAgents: ReadonlyArray<RuntimeSubagent>;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onSelectAgent: (agentId: string) => void;
}) {
  const currentIndex = stepAgents.findIndex((candidate) => candidate.id === agent.id);
  const canStep = currentIndex >= 0 && stepAgents.length > 1;
  const stepTo = (direction: -1 | 1) => {
    if (!canStep) return;
    const nextIndex = (currentIndex + direction + stepAgents.length) % stepAgents.length;
    onSelectAgent(stepAgents[nextIndex]!.id);
  };

  const modelLabel = formatSubagentModelLabel(agent.model, agent.effort);
  const duration =
    agent.startedAt && (agent.completedAt || agent.status !== "running")
      ? elapsedBetween(agent.startedAt, agent.completedAt)
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1.5">
        <Select value={agent.id} onValueChange={(value) => value && onSelectAgent(value)}>
          <SelectTrigger size="xs" className="min-w-0 flex-1" aria-label="Select agent">
            <SelectValue>
              <span className="flex items-center gap-1.5 truncate">
                <StatusDot status={agent.status} />
                <span className="truncate">{agent.title}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {stepAgents.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                <span className="flex items-center gap-1.5">
                  <StatusDot status={candidate.status} />
                  <span className="truncate">{candidate.title}</span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {canStep ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon-micro"
              variant="ghost-muted"
              onClick={() => stepTo(-1)}
              aria-label="Previous agent"
            >
              <ChevronLeft aria-hidden className="size-3.5" />
            </Button>
            <span className="min-w-10 text-center font-mono text-3xs tabular-nums text-muted-foreground">
              {currentIndex + 1}/{stepAgents.length}
            </span>
            <Button
              size="icon-micro"
              variant="ghost-muted"
              onClick={() => stepTo(1)}
              aria-label="Next agent"
            >
              <ChevronRight aria-hidden className="size-3.5" />
            </Button>
          </span>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {environmentId && threadId ? (
            <AgentTranscriptBody agent={agent} environmentId={environmentId} threadId={threadId} />
          ) : (
            <AgentSummaryFallback agent={agent} />
          )}
        </div>
      </ScrollArea>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-3 py-1.5 font-mono text-2xs text-muted-foreground">
        {duration ? <span>{duration}</span> : null}
        {modelLabel ? <span>{modelLabel}</span> : null}
        <span className="tabular-nums">
          Σ {formatSubagentTokenCount(agent.usage?.totalTokens ?? 0)} tok
        </span>
        {agent.usage?.toolUses !== undefined ? <span>{agent.usage.toolUses} tools</span> : null}
        {agent.activationCount > 1 ? <span>run {agent.activationCount}</span> : null}
      </footer>
    </div>
  );
}

/**
 * Owns the detail view's "which agent is currently shown" state, seeded from
 * the surface's target and reset (via the parent's `key`) whenever that
 * target changes externally — e.g. clicking a different row in the Agents
 * list. Internal prev/next/dropdown navigation never touches the surface
 * store, so browsing around doesn't leave a trail of history entries.
 */
function AgentDetailPanel({
  model,
  environmentId,
  threadId,
  initialAgentId,
}: {
  model: AgentPanelModel;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  initialAgentId: string | null;
}) {
  // Bare coordinators (a workflow with zero members) render one AgentRow of
  // their own (see ExpandedWorkflowSection) but are excluded from
  // model.flatAgents — that array is stepper order, this is lookup-by-id.
  const selectableAgents = [...model.flatAgents, ...model.workflows.map((group) => group.workflow)];
  const stepAgentsBase = model.flatAgents.length > 0 ? model.flatAgents : selectableAgents;
  const initialAgent =
    (initialAgentId && selectableAgents.find((agent) => agent.id === initialAgentId)) ||
    selectableAgents[0] ||
    null;
  const [currentAgentId, setCurrentAgentId] = useState(initialAgent?.id ?? null);
  const agent =
    selectableAgents.find((candidate) => candidate.id === currentAgentId) ?? initialAgent;
  if (!agent) return null;
  // A bare workflow coordinator (zero members) is selectable but excluded
  // from stepAgentsBase — without this, the dropdown wouldn't list the very
  // agent it's currently showing.
  const stepAgents = stepAgentsBase.some((candidate) => candidate.id === agent.id)
    ? stepAgentsBase
    : [agent, ...stepAgentsBase];

  return (
    <AgentDetailView
      agent={agent}
      stepAgents={stepAgents}
      environmentId={environmentId}
      threadId={threadId}
      onSelectAgent={setCurrentAgentId}
    />
  );
}

export function AgentsPanel({
  model,
  environmentId = null,
  threadId = null,
  onSelectAgent,
  detailAgentId,
}: {
  model: AgentPanelModel;
  environmentId?: EnvironmentId | null;
  threadId?: ThreadId | null;
  /** List mode: called when a row is picked. Omit in detail mode. */
  onSelectAgent?: (agentId: string) => void;
  /** Presence (not value) switches to detail mode; null falls back to the first agent. */
  detailAgentId?: string | null;
}) {
  if (!model.hasAgents) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Bot aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No agents yet</p>
        <p className="max-w-56 text-xs text-muted-foreground">
          When this thread spawns subagents or runs a workflow, they show up here with live status,
          activity, and token usage.
        </p>
      </div>
    );
  }

  if (detailAgentId !== undefined) {
    return (
      <AgentDetailPanel
        key={detailAgentId ?? "auto"}
        model={model}
        environmentId={environmentId}
        threadId={threadId}
        initialAgentId={detailAgentId}
      />
    );
  }

  const selectAgent = onSelectAgent ?? (() => {});

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {model.workflows.map((group) => (
            <WorkflowSection
              key={group.workflow.id}
              group={group}
              environmentId={environmentId}
              threadId={threadId}
              onSelectAgent={selectAgent}
            />
          ))}
          {model.directAgents.length > 0 ? (
            <section>
              <div className="px-1.5 pt-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
                Direct spawns
              </div>
              {model.directAgents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} onSelect={selectAgent} />
              ))}
            </section>
          ) : null}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 font-mono text-2xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {model.runningCount + model.waitingCount > 0 ? (
            <span className="text-info-foreground">
              ● {model.runningCount + model.waitingCount} working
            </span>
          ) : null}
          {model.idleCount > 0 ? <span>{model.idleCount} idle</span> : null}
          {model.settledCount > 0 ? <span>{model.settledCount} settled</span> : null}
        </span>
        <span className="tabular-nums">Σ {formatSubagentTokenCount(model.totalTokens)} tok</span>
      </footer>
    </div>
  );
}
