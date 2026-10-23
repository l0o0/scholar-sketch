import type { AnnotationBrowserState } from "../chrome/AnnotationBrowser";
import {
  annotationListSourceIdentity,
  type AnnotationListSource,
} from "../model/academic";
import type {
  AnnotationListFailure,
  AnnotationListResult,
} from "../model/protocol";

export interface AnnotationBrowserSession {
  requestId: string;
  source: AnnotationListSource;
  state: AnnotationBrowserState;
  query: string;
  selectedKeys: Set<string>;
}

export function openAnnotationBrowserSession(
  requestId: string,
  source: AnnotationListSource,
): AnnotationBrowserSession {
  return {
    requestId,
    source,
    state: { status: "loading" },
    query: "",
    selectedKeys: new Set(),
  };
}

export function closeAnnotationBrowserSession(
  _session: AnnotationBrowserSession | null,
): null {
  return null;
}

export function replaceDocumentAnnotationBrowserSession(
  _session: AnnotationBrowserSession | null,
): null {
  return null;
}

function matchesReply(
  session: AnnotationBrowserSession | null,
  requestId: string,
  source: AnnotationListSource,
): session is AnnotationBrowserSession {
  return (
    session !== null &&
    session.requestId === requestId &&
    annotationListSourceIdentity(session.source) ===
      annotationListSourceIdentity(source)
  );
}

export function acceptAnnotationListResult(
  session: AnnotationBrowserSession | null,
  requestId: string,
  source: AnnotationListSource,
  result: AnnotationListResult,
): AnnotationBrowserSession | null {
  if (!matchesReply(session, requestId, source)) return session;
  return {
    ...session,
    state: { status: "ready", ...result },
  };
}

export function acceptAnnotationListFailure(
  session: AnnotationBrowserSession | null,
  requestId: string,
  source: AnnotationListSource,
  failure: AnnotationListFailure,
): AnnotationBrowserSession | null {
  if (!matchesReply(session, requestId, source)) return session;
  return {
    ...session,
    state: { status: "unavailable", failure },
  };
}
