import {
  AuthFilesystemReadScope,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { executeAtomQuery, isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";
import { useComposerDraftStore } from "../../composerDraftStore";
import { getFileMetadataQueryAtom } from "../../hooks/useFileMetadata";
import { closeRemoteTerminalSession } from "./remoteTerminalClose";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { serverEnvironment } from "../../state/server";
import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "~/lib/utils";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { readEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  type RemoteTerminal,
  selectThreadRemoteTerminals,
  selectThreadTerminalUiState,
  useTerminalUiStateStore,
} from "../../terminalUiStateStore";

/** Where a new terminal starts. Omitted fields fall back to the thread's project and worktree. */
export interface TerminalLaunchLocation {
  readonly cwd: string;
  readonly worktreePath: string | null;
}

/** Allocate terminal ids and launch locations centrally so all surfaces share one view of sessions. */
export function useThreadTerminalActions(threadRef: ScopedThreadRef | null) {
  const openTerminalCommand = useAtomCommand(terminalEnvironment.open, "terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "terminal write");
  const closeTerminalCommand = useAtomCommand(terminalEnvironment.close, "terminal close");
  const serverThread = useQuietThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const threadWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const knownSessions = useKnownTerminalSessions({
    environmentId: threadRef?.environmentId ?? null,
    threadId: threadRef?.threadId ?? null,
  });
  const drawerTerminalIds = useTerminalUiStateStore(
    (state) => selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef).terminalIds,
  );
  const panelSurfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );

  const canWrite = () =>
    threadRef !== null && readEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope);

  const remoteTerminalFor = (terminalId: string, target = threadRef): RemoteTerminal | null =>
    selectThreadRemoteTerminals(
      useTerminalUiStateStore.getState().remoteTerminalsByThreadKey,
      target,
    )[terminalId] ?? null;

  /** The environment a terminal of this thread runs on. */
  const terminalEnvironmentId = (terminalId: string, target = threadRef): EnvironmentId | null =>
    target ? (remoteTerminalFor(terminalId, target)?.environmentId ?? target.environmentId) : null;

  const canWriteTerminal = (terminalId: string) => {
    const environmentId = terminalEnvironmentId(terminalId);
    return environmentId !== null && readEnvironmentScope(environmentId, AuthTerminalOperateScope);
  };

  // Server lists lag and colliding ids share a PTY; without read access, suffix ids to avoid unseen sessions.
  const allocateTerminalId = () => {
    const ids = new Set([
      ...(knownSessions ?? []).map((session) => session.target.terminalId),
      ...drawerTerminalIds,
      ...panelSurfaces.flatMap((surface) =>
        surface.kind === "terminal" ? surface.terminalIds : [],
      ),
    ]);
    const canReuse =
      knownSessions !== null &&
      threadRef !== null &&
      readEnvironmentScope(threadRef.environmentId, AuthTerminalReadScope);
    return nextTerminalId([...ids], canReuse ? undefined : randomUUID());
  };

  const defaultLaunchLocation = (): TerminalLaunchLocation | null =>
    project
      ? {
          cwd: projectScriptCwd({
            project: { cwd: project.workspaceRoot },
            worktreePath: threadWorktreePath,
          }),
          worktreePath: threadWorktreePath,
        }
      : null;

  /** place mounts the destination before the server open resolves. */
  const launchTerminal = (input: {
    readonly place: (terminalId: string) => void;
    readonly terminalId?: string;
    readonly location?: TerminalLaunchLocation | null;
    readonly extraEnv?: Record<string, string>;
    readonly size?: { readonly cols: number; readonly rows: number };
  }) => {
    if (!threadRef || !canWrite() || !project) return null;
    const location = input.location ?? defaultLaunchLocation();
    if (!location) return null;
    const terminalId = input.terminalId ?? allocateTerminalId();
    input.place(terminalId);
    const result = openTerminalCommand({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        terminalId,
        cwd: location.cwd,
        ...(location.worktreePath !== null ? { worktreePath: location.worktreePath } : {}),
        env: projectScriptRuntimeEnv({
          project: { cwd: project.workspaceRoot },
          worktreePath: location.worktreePath,
          ...(input.extraEnv ? { extraEnv: input.extraEnv } : {}),
        }),
        ...input.size,
      },
    });
    return { terminalId, result };
  };

  const resolveRemoteCwd = async (environmentId: EnvironmentId): Promise<string | null> => {
    const serverCwd = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.cwd;
    if (!serverCwd) return null;
    const threadCwd = defaultLaunchLocation()?.cwd ?? null;
    if (threadCwd === null || !readEnvironmentScope(environmentId, AuthFilesystemReadScope)) {
      return serverCwd;
    }
    const query = getFileMetadataQueryAtom(environmentId, threadCwd);
    if (!query) return serverCwd;
    const result = await executeAtomQuery(appAtomRegistry, query, { reportFailure: false });
    return result._tag === "Success" && result.value?.kind === "directory" ? threadCwd : serverCwd;
  };

  /**
   * Opens a terminal for this thread on another environment, under the thread's own id.
   * `cwd` skips the directory lookup, for a split that follows its source terminal.
   */
  const launchRemoteTerminal = async (input: {
    readonly environmentId: EnvironmentId;
    readonly place: (terminalId: string, remote: RemoteTerminal) => void;
    readonly cwd?: string;
  }) => {
    if (!threadRef || !readEnvironmentScope(input.environmentId, AuthTerminalOperateScope)) {
      return null;
    }
    const cwd = input.cwd ?? (await resolveRemoteCwd(input.environmentId));
    if (cwd === null || !readEnvironmentScope(input.environmentId, AuthTerminalOperateScope)) {
      return null;
    }
    // The suffix keeps the id unique against other browsers and sessions left on the target.
    const terminalId = nextTerminalId(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
        threadRef,
      ).terminalIds,
      randomUUID(),
    );
    const remote: RemoteTerminal = { environmentId: input.environmentId, cwd };
    input.place(terminalId, remote);
    const result = openTerminalCommand({
      environmentId: input.environmentId,
      input: {
        threadId: threadRef.threadId,
        terminalId,
        cwd,
        originEnvironmentId: threadRef.environmentId,
      },
    });
    // A remote tab outlives its machine's metadata, so one whose open failed would linger empty.
    const placedIn = threadRef;
    void result.then((opened) => {
      if (opened._tag === "Failure" && !isAtomCommandInterrupted(opened)) {
        useTerminalUiStateStore.getState().closeTerminal(placedIn, terminalId);
      }
    });
    return { terminalId, result };
  };

  /** Ends a session and deletes its history. A failed close falls back to typing `exit`. */
  const closeTerminalSession = (terminalId: string, target = threadRef) => {
    const remote = remoteTerminalFor(terminalId, target);
    if (target && remote) {
      void closeRemoteTerminalSession({
        environmentId: remote.environmentId,
        threadId: target.threadId,
        terminalId,
      });
      return;
    }
    if (!target || !readEnvironmentScope(target.environmentId, AuthTerminalOperateScope)) return;
    const environmentId = target.environmentId;
    const threadId = target.threadId;
    void (async () => {
      const closeResult = await closeTerminalCommand({
        environmentId,
        input: { threadId, terminalId, deleteHistory: true },
      });
      if (
        closeResult._tag === "Failure" &&
        !isAtomCommandInterrupted(closeResult) &&
        readEnvironmentScope(environmentId, AuthTerminalOperateScope)
      ) {
        await writeTerminal({ environmentId, input: { threadId, terminalId, data: "exit\n" } });
      }
    })();
  };

  const writeToTerminal = (terminalId: string, data: string) => {
    const environmentId = terminalEnvironmentId(terminalId);
    if (!threadRef || !environmentId || !canWriteTerminal(terminalId)) return null;
    return writeTerminal({
      environmentId,
      input: { threadId: threadRef.threadId, terminalId, data },
    });
  };

  return {
    canWrite: useStableCallback(canWrite),
    canWriteTerminal: useStableCallback(canWriteTerminal),
    remoteTerminalFor: useStableCallback(remoteTerminalFor),
    allocateTerminalId: useStableCallback(allocateTerminalId),
    launchTerminal: useStableCallback(launchTerminal),
    launchRemoteTerminal: useStableCallback(launchRemoteTerminal),
    closeTerminalSession: useStableCallback(closeTerminalSession),
    writeToTerminal: useStableCallback(writeToTerminal),
  };
}
