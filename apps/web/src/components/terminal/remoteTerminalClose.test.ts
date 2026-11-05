import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import { closeRemoteTerminalSession } from "./remoteTerminalClose";

const state = vi.hoisted(() => ({ canOperate: false, closeFails: false, closes: 0 }));

vi.mock("../../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../../state/terminal", () => ({ terminalEnvironment: { close: {} } }));
vi.mock("../../state/session", () => ({ readEnvironmentScope: () => state.canOperate }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: async () => {
    state.closes += 1;
    return state.closeFails
      ? AsyncResult.failure(Cause.fail(new Error("unreachable")))
      : AsyncResult.success(undefined);
  },
}));

const target = {
  environmentId: EnvironmentId.make("environment-laptop"),
  threadId: "thread-1",
  terminalId: "term-2-abc",
};
const pending = () => useTerminalUiStateStore.getState().pendingRemoteCloses;

describe("closeRemoteTerminalSession", () => {
  it("keeps a close until its environment takes it", async () => {
    useTerminalUiStateStore.setState({ pendingRemoteCloses: [] });
    Object.assign(state, { canOperate: false, closeFails: false, closes: 0 });

    await closeRemoteTerminalSession(target);
    await closeRemoteTerminalSession(target);
    expect(pending()).toEqual([target]);
    expect(state.closes).toBe(0);

    state.canOperate = true;
    state.closeFails = true;
    const sending = closeRemoteTerminalSession(target);
    // Recorded before the request settles, so a reload mid-close still retries it.
    expect(pending()).toEqual([target]);
    await sending;

    expect(pending()).toEqual([target]);

    state.closeFails = false;
    await closeRemoteTerminalSession(target);
    expect(pending()).toEqual([]);
    expect(state.closes).toBe(2);
  });
});
