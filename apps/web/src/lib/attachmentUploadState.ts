import type { EnvironmentId } from "@t3tools/contracts";

export type ReadyAttachmentUpload = {
  readonly status: "ready";
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
};

export type AttachmentUploadState =
  | {
      readonly status: "uploading";
      readonly environmentId: EnvironmentId;
      readonly progress: number;
      readonly previous?: ReadyAttachmentUpload;
    }
  | ReadyAttachmentUpload
  | {
      readonly status: "failed";
      readonly environmentId: EnvironmentId;
      readonly reason: string;
      /** Retry/release deletes this id; never use a persisted draft attachment id. */
      readonly attachmentId?: string;
      readonly previous?: ReadyAttachmentUpload;
    };

export function attachmentUploadBlockReason(input: {
  readonly imageIds: ReadonlyArray<string>;
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
  readonly environmentId: EnvironmentId;
}): string | null {
  let pending = 0;

  for (const imageId of input.imageIds) {
    const upload = input.uploadsByImageId[imageId];
    // Send retries failed uploads, so they must not disable it.
    if (upload?.status === "failed" && upload.environmentId === input.environmentId) continue;
    if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) {
      pending += 1;
    }
  }

  if (pending > 0) {
    return pending === 1 ? "Attachment still uploading" : "Attachments still uploading";
  }
  return null;
}

/** Combined progress of these attachments while any is still uploading, otherwise null. */
export function pendingAttachmentUploadProgress(
  attachmentIds: ReadonlyArray<string>,
  uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>,
): number | null {
  let tracked = 0;
  let progress = 0;
  let uploading = false;
  for (const id of attachmentIds) {
    const upload = uploadsByImageId[id];
    if (upload === undefined) continue;
    tracked += 1;
    if (upload.status === "uploading") {
      uploading = true;
      progress += upload.progress;
    } else if (upload.status === "ready") {
      progress += 1;
    }
  }
  return uploading ? progress / tracked : null;
}

export function formatAttachmentUploadProgress(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${Math.floor(bounded * 100)}%`;
}
