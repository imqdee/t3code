import { AuthTerminalOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { useEnvironments } from "../../state/environments";
import { useEnvironmentsWithScope } from "../../state/session";
import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import { closeRemoteTerminalSession } from "./remoteTerminalClose";

/** Retries remote terminal closes once their environment can take them again. */
export function RemoteTerminalCloseCoordinator() {
  const pending = useTerminalUiStateStore((state) => state.pendingRemoteCloses);
  const forgetRemoteClose = useTerminalUiStateStore((state) => state.forgetRemoteClose);
  const { isReady, environments } = useEnvironments();
  const pendingEnvironments = [...new Set(pending.map((target) => target.environmentId))]
    .toSorted()
    .map((environmentId: EnvironmentId) => ({ environmentId }));
  const operable = useEnvironmentsWithScope(pendingEnvironments, AuthTerminalOperateScope);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends queued closes to environments outside this client when they regain the terminal grant
  useEffect(() => {
    const known = new Set(environments.map((environment) => environment.environmentId));
    for (const target of pending) {
      // An environment removed from this client will never take the close.
      if (isReady && !known.has(target.environmentId)) forgetRemoteClose(target);
      else if (operable.has(target.environmentId)) void closeRemoteTerminalSession(target);
    }
  }, [environments, forgetRemoteClose, isReady, operable, pending]);
  return null;
}
