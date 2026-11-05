import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  attachmentUploadBlockReason,
  pendingAttachmentUploadProgress,
} from "./attachmentUploadState";

const environmentId = EnvironmentId.make("environment-1");

describe("attachmentUploadBlockReason", () => {
  it("does not accept an upload from another environment", () => {
    expect(
      attachmentUploadBlockReason({
        imageIds: ["image-1"],
        environmentId,
        uploadsByImageId: {
          "image-1": {
            status: "ready",
            environmentId: EnvironmentId.make("environment-2"),
            attachmentId: "pending-1",
          },
        },
      }),
    ).toBe("Attachment still uploading");
  });
});

describe("pendingAttachmentUploadProgress", () => {
  it("averages tracked uploads while one is running and ignores released ones", () => {
    const uploadsByImageId = {
      "image-1": { status: "uploading", environmentId, progress: 0.5 },
      "image-2": { status: "ready", environmentId, attachmentId: "pending-2" },
    } as const;
    expect(
      pendingAttachmentUploadProgress(["image-1", "image-2", "released"], uploadsByImageId),
    ).toBe(0.75);
    expect(pendingAttachmentUploadProgress(["image-2", "released"], uploadsByImageId)).toBeNull();
  });
});
