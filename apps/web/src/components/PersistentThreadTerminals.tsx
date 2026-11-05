import {
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { memo, useEffect } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStableCallback } from "../hooks/useStableCallback";
import type { TerminalContextSelection } from "../lib/terminalContext";
import { focusActiveDrawerTerminal, focusTerminal } from "../lib/terminalFocus";
import { cn } from "~/lib/utils";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { useProject, useQuietThreadShell } from "../state/entities";
import { useEnvironmentScope } from "../state/session";
import { useEnvironments } from "../state/environments";
import { useKnownTerminalSessions } from "../state/terminalSessions";
import {
  selectThreadRemoteTerminals,
  selectThreadTerminalUiState,
  useTerminalUiStateStore,
} from "../terminalUiStateStore";
import { resolveEnvironmentOptionLabel } from "./BranchToolbar.logic";
import { drawerServerTerminalIds } from "./PersistentThreadTerminals.logic";
import { NewTerminalMachineMenu } from "./terminal/NewTerminalMachineMenu";
import { useThreadTerminalActions } from "./terminal/useThreadTerminalActions";
import ThreadTerminalDrawer, { type RemoteTerminalPresentation } from "./ThreadTerminalDrawer";
import { resolveTerminalWorktreePath } from "./ChatView.logic";

/** Where a drawer or panel opens new terminals when a script run overrides the thread's own. */
export type PersistentTerminalLaunchContext = {
  readonly cwd: string;
  readonly worktreePath: string | null;
};

function terminalIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  if (left.length === 0) {
    return true;
  }
  const sortedLeft = left.toSorted((a, b) => a.localeCompare(b));
  const sortedRight = right.toSorted((a, b) => a.localeCompare(b));
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) {
      return false;
    }
  }
  return true;
}

/** Server sessions lag terminal.open; reconciling strict subsets would discard new split layouts. */
function serverTerminalIdsStrictSubsetOfClient(
  serverIds: readonly string[],
  clientIds: readonly string[],
): boolean {
  if (serverIds.length >= clientIds.length || clientIds.length === 0) {
    return false;
  }
  const clientSet = new Set(clientIds);
  for (const id of serverIds) {
    if (!clientSet.has(id)) {
      return false;
    }
  }
  return true;
}

interface TerminalLaunchLocationWithEnv {
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly runtimeEnv?: Record<string, string>;
}

interface PersistentThreadTerminalDrawerProps {
  threadRef: { environmentId: EnvironmentId; threadId: ThreadId };
  threadId: ThreadId;
  active: boolean;
  composerHeight: number;
  launchContext: PersistentTerminalLaunchContext | null;
  splitShortcutLabel: string | undefined;
  splitVerticalShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

export const PersistentThreadTerminalDrawer = memo(function PersistentThreadTerminalDrawer({
  threadRef,
  threadId,
  active,
  composerHeight,
  launchContext,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  keybindings,
  onAddTerminalContext,
}: PersistentThreadTerminalDrawerProps) {
  const canOperateTerminal = useEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope);
  const terminalActions = useThreadTerminalActions(threadRef);
  const serverThread = useQuietThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
  );
  const visible = active && terminalUiState.terminalOpen;
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId,
  });
  const panelSurfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const panelTerminalIds = new Set(
    panelSurfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : [])),
  );
  const drawerTerminalSessions =
    knownTerminalSessions?.filter((session) => !panelTerminalIds.has(session.target.terminalId)) ??
    [];
  const terminalLabelsById = new Map<string, string>();
  for (const session of drawerTerminalSessions) {
    terminalLabelsById.set(
      session.target.terminalId,
      resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
    );
  }
  const terminalLaunchLocationsById = new Map<string, TerminalLaunchLocationWithEnv>();
  for (const session of drawerTerminalSessions) {
    const summary = session.state.summary;
    if (!project || !summary) continue;
    const worktreePathForLaunch =
      launchContext !== null ? launchContext.worktreePath : summary.worktreePath;
    terminalLaunchLocationsById.set(session.target.terminalId, {
      cwd: launchContext?.cwd ?? summary.cwd,
      worktreePath: worktreePathForLaunch,
      runtimeEnv: projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: worktreePathForLaunch,
      }),
    });
  }
  const remoteTerminals = useTerminalUiStateStore((state) =>
    selectThreadRemoteTerminals(state.remoteTerminalsByThreadKey, threadRef),
  );
  const { environments } = useEnvironments();
  const remoteTerminalsById = new Map<string, RemoteTerminalPresentation>();
  for (const [terminalId, remote] of Object.entries(remoteTerminals)) {
    const environment = environments.find(
      (candidate) => candidate.environmentId === remote.environmentId,
    );
    remoteTerminalsById.set(terminalId, {
      environmentId: remote.environmentId,
      environmentLabel: environment
        ? resolveEnvironmentOptionLabel({
            isPrimary: environment.entry.target._tag === "PrimaryConnectionTarget",
            environmentId: remote.environmentId,
            runtimeLabel: environment.label,
          })
        : remote.environmentId,
    });
    // The open sent only a cwd. Attach sends the same, so a session it recreates matches.
    terminalLaunchLocationsById.set(terminalId, { cwd: remote.cwd, worktreePath: null });
  }
  const serverOrderedTerminalIds = drawerServerTerminalIds({
    localIds: drawerTerminalSessions.map((session) => session.target.terminalId),
    remoteTerminals,
    clientIds: terminalUiState.terminalIds,
  });
  const storeSetTerminalHeight = useTerminalUiStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalUiStateStore((state) => state.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore(
    (state) => state.splitTerminalVertical,
  );
  const storeNewTerminal = useTerminalUiStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalUiStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const reconcileTerminalIds = useTerminalUiStateStore((state) => state.reconcileTerminalIds);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles the terminal UI store's ids with the server's terminal list when they diverge
  useEffect(() => {
    if (terminalIdListsEqual(serverOrderedTerminalIds, terminalUiState.terminalIds)) {
      return;
    }
    if (
      serverTerminalIdsStrictSubsetOfClient(serverOrderedTerminalIds, terminalUiState.terminalIds)
    ) {
      return;
    }
    reconcileTerminalIds(threadRef, serverOrderedTerminalIds);
  }, [reconcileTerminalIds, serverOrderedTerminalIds, terminalUiState.terminalIds, threadRef]);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = launchContext !== null ? launchContext.worktreePath : worktreePath;
  const cwd =
    launchContext?.cwd ??
    (project
      ? projectScriptCwd({
          project: { cwd: project.workspaceRoot },
          worktreePath: effectiveWorktreePath,
        })
      : null);
  const runtimeEnv = project
    ? projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: effectiveWorktreePath,
      })
    : {};

  const setTerminalHeight = (height: number) => {
    storeSetTerminalHeight(threadRef, height);
  };

  const launchDrawerTerminal = (place: (terminalId: string) => void) => {
    if (!cwd) return;
    const launched = terminalActions.launchTerminal({
      place,
      location: { cwd, worktreePath: effectiveWorktreePath },
    });
    if (!launched) return;
    if (visible) focusTerminal(threadRef, launched.terminalId);
    void launched.result;
  };
  const launchRemoteDrawerTerminal = (
    environmentId: EnvironmentId,
    place: Parameters<typeof terminalActions.launchRemoteTerminal>[0]["place"],
    cwdOverride?: string,
  ) => {
    void terminalActions
      .launchRemoteTerminal({
        environmentId,
        place,
        ...(cwdOverride !== undefined ? { cwd: cwdOverride } : {}),
      })
      .then((launched) => {
        if (launched && visible) focusTerminal(threadRef, launched.terminalId);
      });
  };
  // A split follows the active terminal's machine and directory.
  const splitDrawerTerminal = (direction: "horizontal" | "vertical") => {
    const split = direction === "vertical" ? storeSplitTerminalVertical : storeSplitTerminal;
    const remote = remoteTerminals[terminalUiState.activeTerminalId];
    if (remote) {
      launchRemoteDrawerTerminal(
        remote.environmentId,
        (terminalId, placed) => split(threadRef, terminalId, placed),
        remote.cwd,
      );
      return;
    }
    launchDrawerTerminal((terminalId) => split(threadRef, terminalId));
  };
  const splitTerminal = useStableCallback(() => splitDrawerTerminal("horizontal"));
  const splitTerminalVertical = useStableCallback(() => splitDrawerTerminal("vertical"));
  const createRemoteTerminal = useStableCallback((environmentId: EnvironmentId) =>
    launchRemoteDrawerTerminal(environmentId, (terminalId, placed) =>
      storeNewTerminal(threadRef, terminalId, placed),
    ),
  );
  const createNewTerminal = useStableCallback(() =>
    launchDrawerTerminal((terminalId) => storeNewTerminal(threadRef, terminalId)),
  );

  const activateTerminal = (terminalId: string) => {
    storeSetActiveTerminal(threadRef, terminalId);
    if (visible) focusTerminal(threadRef, terminalId);
  };

  const closeTerminal = useStableCallback((terminalId: string) => {
    if (remoteTerminals[terminalId] === undefined && !terminalActions.canWrite()) return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(threadRef, terminalId);
    if (visible) focusActiveDrawerTerminal(threadRef);
  });

  const handleAddTerminalContext = (selection: TerminalContextSelection) => {
    if (!visible) {
      return;
    }
    onAddTerminalContext(selection);
  };

  if (!project || (!terminalUiState.terminalOpen && !active) || !cwd) {
    return null;
  }

  return (
    <div
      className={cn(
        "grid shrink-0 overflow-clip",
        active ? (visible ? "grid-rows-[1fr]" : "grid-rows-[0fr]") : "hidden",
        active &&
          "[[data-panel-animations=true]_&]:transition-[grid-template-rows] [[data-panel-animations=true]_&]:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:ease-out",
        active && visible && "[[data-panel-animations=true]_&]:starting:grid-rows-[0fr]!",
      )}
    >
      <div className="min-h-0 overflow-clip">
        <ThreadTerminalDrawer
          threadRef={threadRef}
          threadId={threadId}
          cwd={cwd}
          worktreePath={effectiveWorktreePath}
          runtimeEnv={runtimeEnv}
          visible={visible}
          height={terminalUiState.terminalHeight}
          composerHeight={composerHeight}
          // Known-session order is MRU and changes on focus; persisted store order keeps sidebar labels stable.
          terminalIds={canOperateTerminal ? terminalUiState.terminalIds : serverOrderedTerminalIds}
          activeTerminalId={terminalUiState.activeTerminalId}
          terminalGroups={terminalUiState.terminalGroups}
          activeTerminalGroupId={terminalUiState.activeTerminalGroupId}
          onSplitTerminal={splitTerminal}
          onSplitTerminalVertical={splitTerminalVertical}
          onNewTerminal={createNewTerminal}
          splitShortcutLabel={visible ? splitShortcutLabel : undefined}
          splitVerticalShortcutLabel={visible ? splitVerticalShortcutLabel : undefined}
          newShortcutLabel={visible ? newShortcutLabel : undefined}
          closeShortcutLabel={visible ? closeShortcutLabel : undefined}
          keybindings={keybindings}
          onActiveTerminalChange={activateTerminal}
          onCloseTerminal={closeTerminal}
          onHeightChange={setTerminalHeight}
          onAddTerminalContext={handleAddTerminalContext}
          terminalLabelsById={terminalLabelsById}
          terminalLaunchLocationsById={terminalLaunchLocationsById}
          remoteTerminalsById={remoteTerminalsById}
          newTerminalMachineMenu={
            environments.some(
              (environment) => environment.environmentId !== threadRef.environmentId,
            ) ? (
              <NewTerminalMachineMenu
                threadEnvironmentId={threadRef.environmentId}
                canOpenOnThreadEnvironment={canOperateTerminal}
                onNewTerminal={createNewTerminal}
                onSelectEnvironment={createRemoteTerminal}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );
});

export interface PersistentThreadTerminalPanelProps {
  visible: boolean;
  threadRef: ScopedThreadRef;
  surface: Extract<RightPanelSurface, { kind: "terminal" }>;
  launchContext: PersistentTerminalLaunchContext | null;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  onSplitTerminal: () => void;
  onSplitTerminalVertical: () => void;
  onNewTerminal: () => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string, threadRef?: ScopedThreadRef) => void;
  splitShortcutLabel?: string | undefined;
  splitVerticalShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
}

export const PersistentThreadTerminalPanel = memo(function PersistentThreadTerminalPanel({
  visible,
  threadRef,
  surface,
  launchContext,
  keybindings,
  onAddTerminalContext,
  onSplitTerminal,
  onSplitTerminalVertical,
  onNewTerminal,
  onActiveTerminalChange,
  onCloseTerminal,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
}: PersistentThreadTerminalPanelProps) {
  const serverThread = useQuietThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });
  const threadWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeSummary =
    knownTerminalSessions?.find((session) => session.target.terminalId === surface.activeTerminalId)
      ?.state.summary ?? null;
  const worktreePath = resolveTerminalWorktreePath({
    launchContext,
    summary: activeSummary,
    threadWorktreePath,
  });
  const cwd =
    launchContext?.cwd ??
    activeSummary?.cwd ??
    (project ? projectScriptCwd({ project: { cwd: project.workspaceRoot }, worktreePath }) : null);
  const runtimeEnv = project
    ? projectScriptRuntimeEnv({ project: { cwd: project.workspaceRoot }, worktreePath })
    : {};
  const terminalLabelsById = new Map<string, string>();
  const terminalLaunchLocationsById = new Map<string, TerminalLaunchLocationWithEnv>();
  for (const terminalId of surface.terminalIds) {
    const summary =
      knownTerminalSessions?.find((session) => session.target.terminalId === terminalId)?.state
        .summary ?? null;
    terminalLabelsById.set(terminalId, resolveTerminalSessionLabel(terminalId, summary));
    if (!project) continue;
    const terminalWorktreePath = resolveTerminalWorktreePath({
      launchContext,
      summary,
      threadWorktreePath,
    });
    terminalLaunchLocationsById.set(terminalId, {
      cwd:
        launchContext?.cwd ??
        summary?.cwd ??
        projectScriptCwd({
          project: { cwd: project.workspaceRoot },
          worktreePath: terminalWorktreePath,
        }),
      worktreePath: terminalWorktreePath,
      runtimeEnv: projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: terminalWorktreePath,
      }),
    });
  }

  if (!project || !cwd) return null;

  return (
    <ThreadTerminalDrawer
      mode="panel"
      visible={visible}
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd={cwd}
      worktreePath={worktreePath}
      runtimeEnv={runtimeEnv}
      height={0}
      terminalIds={surface.terminalIds}
      activeTerminalId={surface.activeTerminalId}
      terminalGroups={[
        {
          id: surface.id,
          terminalIds: surface.terminalIds,
          ...(surface.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
        },
      ]}
      activeTerminalGroupId={surface.id}
      onSplitTerminal={onSplitTerminal}
      onSplitTerminalVertical={onSplitTerminalVertical}
      onNewTerminal={onNewTerminal}
      splitShortcutLabel={splitShortcutLabel}
      splitVerticalShortcutLabel={splitVerticalShortcutLabel}
      newShortcutLabel={newShortcutLabel}
      closeShortcutLabel={closeShortcutLabel}
      onActiveTerminalChange={onActiveTerminalChange}
      onCloseTerminal={onCloseTerminal}
      onHeightChange={() => undefined}
      onAddTerminalContext={onAddTerminalContext}
      terminalLabelsById={terminalLabelsById}
      terminalLaunchLocationsById={terminalLaunchLocationsById}
      keybindings={keybindings}
    />
  );
});
