import { ORCHESTRATION_WS_METHODS, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createOrchestrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    turnDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-diff",
      tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
    }),
    workflowScript: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:workflow-script",
      tag: ORCHESTRATION_WS_METHODS.getWorkflowScript,
      // Scripts are immutable per run: cache generously.
      staleTimeMs: 300_000,
      idleTtlMs: 300_000,
    }),
    fullThreadDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:full-thread-diff",
      tag: ORCHESTRATION_WS_METHODS.getFullThreadDiff,
    }),
    threadSearch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-search",
      tag: ORCHESTRATION_WS_METHODS.searchThreads,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    archivedShellSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:archived-shell-snapshot",
      tag: ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
    }),
    // Provider-scoped (not orchestration-scoped) RPC, but fetched from the
    // same panel as the rest of this group — see AgentDetailView. Short
    // staleness + a refresh interval so opening the detail view on a still-
    // running subagent (transcript not written yet, RPC returns "unavailable")
    // doesn't get stuck showing the summary fallback after the subagent
    // finishes — it re-polls while the view stays open instead of caching
    // "unavailable" indefinitely.
    subagentTranscript: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:provider:subagent-transcript",
      tag: WS_METHODS.providerGetSubagentTranscript,
      staleTimeMs: 5_000,
      refreshIntervalMs: 5_000,
    }),
  };
}
