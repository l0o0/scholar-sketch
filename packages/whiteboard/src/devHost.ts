/// <reference types="zotero-types/entries/sandbox" />

import {
  createFakeZotero,
  type FakeItemData,
} from "@zotero-plugin/fake-zotero";
import { createZoteroSourceGateway } from "../../../src/modules/whiteboard/source-gateway";
import { emptyCanvasDocument, parseCanvasDocument } from "./model/document";
import type {
  AcademicAcquisitionBatch,
  AcademicDropSourceRef,
} from "./model/protocol";
import type { WhiteboardAppProps, WhiteboardRuntime } from "./whiteboard/app";

export const DEMO_STORAGE_KEY = "fake-zotero:whiteboard:v1";
const items: FakeItemData[] = [
  {
    id: 5,
    key: "FILE0001",
    itemType: "attachment",
    parentID: 1,
    attachmentContentType: "text/plain",
    fields: { title: "Research data.txt" },
  },
  {
    id: 1,
    key: "PAPER001",
    itemType: "journalArticle",
    fields: {
      title: "A browser laboratory for Zotero plugins",
      date: "2026-09-22",
      publicationTitle: "Example Research Library",
      creators: "Ada Lovelace",
    },
    creators: [
      { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
    ],
    tags: [{ tag: "browser-testing" }],
  },
  {
    id: 2,
    key: "PDF00001",
    itemType: "attachment",
    parentID: 1,
    attachmentContentType: "application/pdf",
    fields: { title: "Example paper.pdf" },
  },
  {
    id: 3,
    key: "QUOTE001",
    itemType: "annotation",
    parentID: 2,
    annotationType: "highlight",
    annotationText:
      "A reproducible fixture makes UI failures easier to explain.",
    annotationComment: "Inspect this annotation in the real whiteboard UI.",
    annotationColor: "#ffd400",
    annotationPageLabel: "2",
    annotationPosition: '{"pageIndex":1}',
    annotationSortIndex: "00001|000001|00001",
  },
  {
    id: 4,
    key: "NOTE0001",
    itemType: "note",
    parentID: 1,
    note: "<p>Fixture note</p><p>Original note from the fake Zotero library.</p>",
  },
];

type DemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Browser-only adapter. The gateway and WhiteboardApp remain production code. */
export function createBrowserDemo(
  options: {
    storage?: DemoStorage;
    report?: (message: string) => void;
  } = {},
) {
  const fake = createFakeZotero({ items });
  const restore = fake.install();
  const gateway = createZoteroSourceGateway();
  let runtime: WhiteboardRuntime | null = null;
  let sequence = 0;
  const report = options.report ?? (() => undefined);

  function ready() {
    if (!runtime) throw new Error("The whiteboard is not ready.");
    return runtime;
  }

  function itemByID(id: number) {
    const item = fake.Zotero.Items.get(id);
    if (!item) throw new Error(`Unknown fixture item ${id}.`);
    return item;
  }

  async function acquire(
    requestId: string,
    nodeId: string,
    sources: AcademicDropSourceRef[],
  ) {
    const batch: AcademicAcquisitionBatch = { successes: [], failures: [] };
    for (const [index, source] of sources.entries()) {
      const key =
        "annotationKey" in source
          ? source.annotationKey
          : "attachmentKey" in source
            ? source.attachmentKey
            : source.itemKey;
      const item = fake.Zotero.Items.getByLibraryAndKey(1, key);
      if (!item) {
        batch.failures.push({ index, code: "item-missing", message: key });
        continue;
      }
      try {
        batch.successes.push({
          index,
          acquisition:
            "annotationKey" in source
              ? await gateway.acquireQuote(source)
              : gateway.acquireItem(item as unknown as Zotero.Item),
        });
      } catch (error) {
        batch.failures.push({
          index,
          code: "acquisition-failed",
          message: String(error),
        });
      }
    }
    ready().resolveAcademicAcquisitionBatch(
      requestId,
      nodeId,
      batch.successes,
      batch.failures,
    );
  }

  function save() {
    const api = ready();
    api.setSaveState("saving");
    try {
      if (!options.storage) throw new Error("Browser storage is unavailable.");
      options.storage.setItem(
        DEMO_STORAGE_KEY,
        JSON.stringify(api.getSnapshot()),
      );
      api.setSaveState("saved");
      report("Saved in this browser.");
    } catch (error) {
      api.setSaveState("error");
      report(`Save failed: ${String(error)}`);
    }
  }

  function readSaved() {
    const raw = options.storage?.getItem(DEMO_STORAGE_KEY);
    return raw ? parseCanvasDocument(JSON.parse(raw)).document : null;
  }

  function reload() {
    try {
      const snapshot = readSaved();
      if (!snapshot) throw new Error("No saved board in this browser.");
      ready().loadSnapshot(snapshot);
      ready().setSaveState("saved");
      report("Reloaded the saved board.");
    } catch (error) {
      report(`Reload failed: ${String(error)}`);
    }
  }

  const callbacks: Omit<WhiteboardAppProps, "theme" | "initialSnapshot"> = {
    onReady(api) {
      runtime = api;
    },
    onChange() {},
    onSave: save,
    onPickAcademicSource(requestId, nodeId) {
      void acquire(requestId, nodeId, [
        { library: { type: "user" }, itemKey: "PAPER001" },
      ]);
      report("Selected the demo paper from the fake library.");
    },
    async onDropAcademicSources(requestId, nodeId, sources) {
      if (sources.some((source) => source.library.type !== "user")) {
        ready().rejectAcademicRequest(requestId, nodeId, "library-missing");
        return;
      }
      await acquire(requestId, nodeId, sources);
    },
    async onResolveAcademicSources(_requestId, generation, _priority, sources) {
      const results = await Promise.all(
        sources.map(({ nodeId, source }) =>
          gateway.resolve(nodeId, generation, source),
        ),
      );
      ready().applySourceResolutionBatch(generation, results);
    },
    async onOpenAcademicSource(requestId, nodeId, source) {
      try {
        await gateway.open(source);
        ready().acceptSourceAction(requestId, nodeId, "open", source);
        report(
          "Open recorded in fake.calls (the browser has no native Zotero reader).",
        );
      } catch (error) {
        ready().rejectSourceAction(requestId, nodeId, source, {
          code: "open-failed",
          message: String(error),
        });
      }
    },
    async onListLiteratureAnnotations(requestId, source) {
      try {
        const result = await gateway.listAnnotations(source);
        ready().applyAnnotationCandidates(
          requestId,
          source,
          result.candidates,
          result.failures,
        );
      } catch (error) {
        ready().rejectAnnotationList(requestId, source, {
          code: "list-failed",
          message: String(error),
        });
      }
    },
    async onRefreshZoteroNote(requestId, nodeId, source) {
      try {
        ready().applyNoteRefresh(
          requestId,
          nodeId,
          await gateway.refreshNote(source),
        );
        report("Refreshed the note from the fake library.");
      } catch (error) {
        ready().rejectAcademicRequest(requestId, nodeId, "note-refresh-failed");
        report(String(error));
      }
    },
    async onOpenItem({ itemID, attachmentID, pdfPage }) {
      try {
        if (attachmentID)
          await fake.Zotero.Reader.open(attachmentID, { pageIndex: pdfPage });
        else if (itemID)
          await fake.Zotero.getMainWindow().ZoteroPane.selectItem(itemID);
        report("Open recorded in fake.calls.");
      } catch (error) {
        report(String(error));
      }
    },
    onExportFile(payload) {
      const url =
        payload.dataUrl ??
        URL.createObjectURL(
          new Blob([payload.text ?? ""], { type: payload.mimeType }),
        );
      const link = document.createElement("a");
      link.href = url;
      link.download = `fake-zotero-board.${payload.format}`;
      link.click();
      if (!payload.dataUrl) setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };

  return {
    fake,
    gateway,
    callbacks,
    get isReady() {
      return runtime !== null;
    },
    getSnapshot: () => structuredClone(ready().getSnapshot()),
    readSaved,
    save,
    reload,
    importItem(id: number) {
      const item = itemByID(id);
      do {
        sequence++;
      } while (
        ready()
          .getSnapshot()
          .nodes.some((node) => node.id === `demo-node-${sequence}`)
      );
      const serial = sequence;
      ready().beginAcademicDrop(
        `demo-request-${serial}`,
        `demo-node-${serial}`,
        {
          x: 100 + ((serial - 1) % 3) * 300,
          y: 220 + Math.floor((serial - 1) / 3) * 220,
        },
        [
          item.isAttachment()
            ? { library: { type: "user" }, attachmentKey: item.key }
            : { library: { type: "user" }, itemKey: item.key },
        ],
      );
    },
    async updateNote() {
      const note = itemByID(4);
      note.setNote(
        "<p>Fixture note</p><p>Updated in the fake Zotero library. Refresh the note card to see this text.</p>",
      );
      await note.saveTx();
      report("Library note changed. Use Refresh from Zotero on the note card.");
    },
    reset() {
      try {
        options.storage?.removeItem(DEMO_STORAGE_KEY);
        fake.reset();
        sequence = 0;
        ready().loadSnapshot(emptyCanvasDocument());
        ready().setSaveState("saved");
        report("Fixture and board reset.");
      } catch (error) {
        report(`Reset failed: ${String(error)}`);
      }
    },
    dispose: restore,
  };
}
