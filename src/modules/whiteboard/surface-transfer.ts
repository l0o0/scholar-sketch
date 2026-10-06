import type { ParsedCanvasFile } from "../../../packages/whiteboard/src/model/canvas-file";
import { FileConflictError, type FileRevision } from "../file-safety";
import type { WhiteboardHandle } from "./editor";
import type { WhiteboardSaveCoordinator } from "./save-coordinator";
import type { CanvasDocument } from "./snapshot";

interface WhiteboardSurfaceTransferSource {
  editor?: Pick<WhiteboardHandle, "requestSnapshot">;
  saveCoordinator?: Pick<WhiteboardSaveCoordinator, "request">;
  fileRevision?: FileRevision;
}

interface WhiteboardSurfaceTransfer {
  document: CanvasDocument;
  revision?: FileRevision;
  issues: ParsedCanvasFile["issues"];
  conflict?: FileConflictError;
}

/** Capture again after the replacement surface is ready; never reuse an old draft. */
export async function captureWhiteboardSurfaceTransfer(
  source: WhiteboardSurfaceTransferSource,
  readPersisted: () => Promise<ParsedCanvasFile & { source: string }>,
): Promise<WhiteboardSurfaceTransfer> {
  let conflict: FileConflictError | undefined;
  try {
    await source.saveCoordinator?.request({ force: true });
  } catch (error) {
    if (!(error instanceof FileConflictError)) throw error;
    conflict = error;
  }

  if (conflict) {
    // Preserve the old comparison baseline so the migrated draft cannot
    // silently overwrite the external edit on its next save.
    if (!source.editor || !source.fileRevision) throw conflict;
    const shot = await source.editor.requestSnapshot();
    return {
      document: shot.snapshot,
      revision: { content: source.fileRevision.content },
      issues: [],
      conflict,
    };
  }

  const persisted = await readPersisted();
  return {
    document: persisted.document,
    revision: { content: persisted.source },
    issues: persisted.issues,
  };
}
