import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { drawerServerTerminalIds } from "./PersistentThreadTerminals.logic";

const LAPTOP = "environment-laptop" as EnvironmentId;

describe("drawerServerTerminalIds", () => {
  it("keeps remote tabs and the client's order, whatever the thread's server reports", () => {
    expect(
      drawerServerTerminalIds({
        localIds: ["term-1", "term-a", "term-x"],
        remoteTerminals: {
          "term-a": { environmentId: LAPTOP, cwd: "/work" },
          "term-gone": { environmentId: LAPTOP, cwd: "/work" },
        },
        clientIds: ["term-a", "term-1"],
      }),
    ).toEqual(["term-a", "term-1", "term-x"]);
  });
});
