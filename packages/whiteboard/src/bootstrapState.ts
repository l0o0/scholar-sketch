import type {
  ParentToWhiteboardMessage,
  WhiteboardLabels,
} from "./model/protocol";
import type { WhiteboardRuntime } from "./whiteboard/app";

type LabelsTarget = Pick<WhiteboardRuntime, "setLabels">;

type AcademicMessageTarget = Pick<
  WhiteboardRuntime,
  | "beginAcademicDrop"
  | "rejectAcademicDrop"
  | "resolveAcademicAcquisitionBatch"
  | "rejectAcademicRequest"
  | "rejectSourceAction"
  | "acceptSourceAction"
  | "applySourceResolutionBatch"
  | "applyNoteRefresh"
  | "applyAnnotationCandidates"
  | "rejectAnnotationList"
>;

export function forwardAcademicParentMessage(
  target: AcademicMessageTarget | null,
  data: ParentToWhiteboardMessage,
): boolean {
  if (data.type === "academicDropStarted") {
    target?.beginAcademicDrop(
      data.payload.requestId,
      data.payload.nodeId,
      data.payload.position,
      data.payload.sources,
      data.payload.interaction,
    );
    return true;
  }
  if (data.type === "academicDropRejected") {
    target?.rejectAcademicDrop(data.payload.code);
    return true;
  }
  if (data.type === "academicSourcesAcquired") {
    target?.resolveAcademicAcquisitionBatch(
      data.payload.requestId,
      data.payload.nodeId,
      data.payload.successes,
      data.payload.failures,
    );
    return true;
  }
  if (data.type === "academicRequestFailed") {
    target?.rejectAcademicRequest(
      data.payload.requestId,
      data.payload.nodeId,
      data.payload.code,
    );
    return true;
  }
  if (data.type === "sourceActionFailed") {
    target?.rejectSourceAction(
      data.payload.requestId,
      data.payload.nodeId,
      data.payload.source,
      data.payload.failure,
    );
    return true;
  }
  if (data.type === "sourceActionSucceeded") {
    target?.acceptSourceAction(
      data.payload.requestId,
      data.payload.nodeId,
      data.payload.action,
      data.payload.source,
    );
    return true;
  }
  if (data.type === "sourceResolutionBatch") {
    target?.applySourceResolutionBatch(
      data.payload.generation,
      data.payload.results,
    );
    return true;
  }
  if (data.type === "noteRefreshed") {
    target?.applyNoteRefresh(
      data.payload.requestId,
      data.payload.nodeId,
      data.payload.acquisition,
    );
    return true;
  }
  if (data.type === "annotationsListed") {
    target?.applyAnnotationCandidates(
      data.payload.requestId,
      data.payload.source,
      data.payload.candidates,
      data.payload.failures,
    );
    return true;
  }
  if (data.type === "annotationListFailed") {
    target?.rejectAnnotationList(
      data.payload.requestId,
      data.payload.source,
      data.payload.failure,
    );
    return true;
  }
  return false;
}

export function createDeferredLabels() {
  let current: WhiteboardLabels | undefined;
  let target: LabelsTarget | null = null;
  return {
    get current() {
      return current;
    },
    receive(next: WhiteboardLabels | undefined) {
      current = next;
      if (next) target?.setLabels(next);
    },
    attach(next: LabelsTarget) {
      target = next;
      if (current) next.setLabels(current);
    },
    detach() {
      target = null;
    },
  };
}
