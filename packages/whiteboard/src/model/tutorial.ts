import { createAcademicNode, type NoteType } from "./academic";
import { createBasicNode } from "./basic";
import { createAcademicConnection } from "./connection";
import { CANVAS_DOCUMENT_VERSION, type CanvasDocument } from "./document";
import type { AcademicAcquisition } from "./protocol";
import { tutorialLogo } from "./tutorial-logo";

export interface TutorialCanvasLabels {
  title: string;
  welcome: string;
  welcomeBody: string;
  quickStart: string;
  quickStartBody: string;
  sourceNotice: string;
  addLiterature: string;
  addLiteratureBody: string;
  browseQuotes: string;
  browseQuotesBody: string;
  writeNote: string;
  writeNoteBody: string;
  questionBadge: string;
  claimBadge: string;
  organize: string;
  organizeBody: string;
  practice: string;
  practiceBody: string;
  supports: string;
  exampleSource: string;
  exampleSourceBody: string;
  exampleQuote: string;
  exampleQuoteBody: string;
  imageTitle: string;
  imageBody: string;
  attachmentTitle: string;
  attachmentBody: string;
  attachmentContent: string;
  colorNote: string;
  colorEvidence: string;
  colorSummary: string;
  organizeAction: string;
  colorQuestion: string;
  colorClaim: string;
  colorBody: string;
  share: string;
  shareBody: string;
}

export interface TutorialCanvasSample {
  literature: Extract<AcademicAcquisition, { kind: "literature" }>;
  quotes: Array<Extract<AcademicAcquisition, { kind: "quote" }>>;
  note?: Extract<AcademicAcquisition, { kind: "note" }>;
}

const sampleStyle = { stroke: "#60a5fa", strokeWidth: 2, radius: 12 } as const;

/** Replace the tutorial's legacy fixed opening view, but keep a saved user view. */
export function hasDefaultTutorialViewport(document: CanvasDocument): boolean {
  return (
    document.nodes.some((node) => node.id === "tutorial-title") &&
    document.viewport?.x === 40 &&
    document.viewport.y === 70 &&
    document.viewport.zoom === 0.5
  );
}

// A self-contained figure, so the tutorial works offline and survives export
// and .canvas round trips without depending on a remote image URL.
const tutorialFigure = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" viewBox="0 0 720 280"><rect width="720" height="280" rx="16" fill="#eaf0e8"/><path d="M90 205C205 205 195 72 330 72S480 188 625 82" fill="none" stroke="#738c67" stroke-width="5"/><path d="M90 205L330 72L625 82" fill="none" stroke="#a2b49a" stroke-width="2" stroke-dasharray="6 9"/><circle cx="90" cy="205" r="23" fill="#e4eef5" stroke="#7294ae" stroke-width="4"/><circle cx="330" cy="72" r="31" fill="#fbefcf" stroke="#c1a052" stroke-width="4"/><circle cx="625" cy="82" r="42" fill="#e5eee0" stroke="#738c67" stroke-width="4"/><path d="M66 250H650" stroke="#c7d2c1" stroke-width="2"/></svg>',
)}`;

export function tutorialCanvasDocument(
  labels: TutorialCanvasLabels,
  sample?: TutorialCanvasSample,
): CanvasDocument {
  const note = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    badge: string,
    content: string,
    noteType: NoteType = "note",
  ) =>
    createAcademicNode("note", { x, y }, id, {
      width,
      height,
      ...(badge ? { badge } : {}),
      noteType,
      content,
      style: { fontSize: 17 },
    });
  const title = {
    ...createBasicNode("text", { x: 0, y: 0 }, "tutorial-title"),
    width: 1480,
    height: 104,
    data: { title: labels.title.replace(/\.canvas$/i, "") },
    style: {
      fill: "transparent",
      stroke: "transparent",
      fontSize: 42,
      fontWeight: "bold",
      textAlign: "left",
    } as const,
  };
  const welcome = note(
    "tutorial-welcome",
    0,
    120,
    440,
    120,
    labels.welcome,
    labels.welcomeBody,
  );
  const sourceNotice = {
    ...createBasicNode("text", { x: 520, y: 120 }, "tutorial-source-notice"),
    width: 960,
    height: 100,
    data: { title: labels.sourceNotice },
    style: {
      fill: "transparent",
      stroke: "transparent",
      fontSize: 17,
      textAlign: "left",
      verticalAlign: "top",
    } as const,
  };
  const addLiterature = note(
    "tutorial-add-literature",
    0,
    270,
    440,
    120,
    labels.addLiterature,
    labels.addLiteratureBody,
  );
  const browseQuotes = note(
    "tutorial-browse-quotes",
    520,
    270,
    440,
    120,
    labels.browseQuotes,
    labels.browseQuotesBody,
  );
  const writeNote = note(
    "tutorial-write-note",
    1040,
    270,
    440,
    120,
    labels.writeNote,
    labels.writeNoteBody,
  );
  const question = note(
    "tutorial-question",
    1040,
    430,
    170,
    190,
    "",
    labels.colorQuestion,
    "question",
  );
  const claim = note(
    "tutorial-claim",
    1310,
    430,
    170,
    190,
    "",
    labels.colorClaim,
    "claim",
  );
  const organize = {
    ...createAcademicNode("frame", { x: 0, y: 880 }, "tutorial-organize"),
    width: 1480,
    height: 360,
    title: labels.organize,
    style: { radius: 16 },
  };
  const practice = {
    ...createAcademicNode("frame", { x: 0, y: 1280 }, "tutorial-practice"),
    width: 1480,
    height: 300,
    title: labels.practice,
    style: { radius: 16 },
  };
  const organizeBody = {
    ...note(
      "tutorial-organize-body",
      30,
      1340,
      440,
      210,
      labels.organizeAction,
      labels.organizeBody,
    ),
    frameId: practice.id,
  };
  const practiceBody = {
    ...note(
      "tutorial-practice-body",
      520,
      1340,
      440,
      210,
      labels.practice,
      labels.practiceBody,
    ),
    frameId: practice.id,
  };
  const image = {
    ...createBasicNode("attachment", { x: 0, y: 650 }, "tutorial-image"),
    width: 280,
    height: 200,
    data: {
      title: labels.imageTitle,
      subtitle: labels.imageBody,
      image: tutorialFigure,
    },
    style: { ...sampleStyle },
  };
  const attachment = {
    ...createBasicNode("attachment", { x: 310, y: 650 }, "tutorial-attachment"),
    width: 190,
    height: 200,
    data: {
      title: labels.attachmentTitle,
      subtitle: labels.attachmentBody,
      preview: labels.attachmentContent,
    },
    style: { ...sampleStyle },
  };
  const nodes: CanvasDocument["nodes"] = [
    title,
    welcome,
    sourceNotice,
    addLiterature,
    browseQuotes,
    writeNote,
    question,
    claim,
    organize,
    organizeBody,
    practice,
    practiceBody,
    image,
    attachment,
    ...(["note", "question", "claim", "evidence", "summary"] as const).map(
      (type, index) => ({
        ...note(
          `tutorial-color-${type}`,
          30 + index * 290,
          940,
          210,
          160,
          "",
          {
            note: labels.colorNote,
            question: labels.colorQuestion,
            claim: labels.colorClaim,
            evidence: labels.colorEvidence,
            summary: labels.colorSummary,
          }[type],
          type,
        ),
        frameId: organize.id,
      }),
    ),
    {
      ...createBasicNode("text", { x: 30, y: 1120 }, "tutorial-color-guide"),
      width: 1420,
      height: 100,
      data: { title: labels.colorBody },
      style: {
        fontSize: 17,
        textAlign: "left" as const,
        fill: "transparent",
        stroke: "transparent",
      },
      frameId: organize.id,
    },
    {
      ...note(
        "tutorial-share",
        1010,
        1340,
        440,
        210,
        labels.share,
        labels.shareBody,
      ),
      frameId: practice.id,
    },
  ];
  const connections: CanvasDocument["connections"] = [
    {
      ...createAcademicConnection(
        "tutorial-path-literature-quotes",
        addLiterature.id,
        browseQuotes.id,
        "related",
      ),
      color: "#64748b",
      dashed: true,
      arrow: false,
    },
    {
      ...createAcademicConnection(
        "tutorial-path-quotes-note",
        browseQuotes.id,
        writeNote.id,
        "related",
      ),
      color: "#64748b",
      dashed: true,
      arrow: false,
    },
    {
      ...createAcademicConnection(
        "tutorial-supports",
        "tutorial-color-evidence",
        "tutorial-color-claim",
        "supports",
      ),
      label: labels.supports,
      sourceHandle: "left",
      targetHandle: "right",
      color: "#2f855a",
      arrow: true,
    },
    {
      ...createAcademicConnection(
        "tutorial-contradicts",
        question.id,
        claim.id,
        "contradicts",
      ),
      color: "#c2413a",
      dashed: true,
      arrow: true,
      startArrow: true,
    },
  ];

  if (!sample) {
    nodes.push(
      note(
        "tutorial-example-source",
        0,
        430,
        440,
        190,
        labels.exampleSource,
        labels.exampleSourceBody,
      ),
    );
  }
  if (!sample?.quotes.length) {
    nodes.push(
      note(
        "tutorial-example-quote",
        520,
        430,
        440,
        400,
        labels.exampleQuote,
        labels.exampleQuoteBody,
      ),
    );
  }

  if (sample) {
    const literature = {
      ...createAcademicNode(
        "literature",
        { x: 0, y: 430 },
        "tutorial-sample-literature",
        {
          source: copySource(sample.literature.source),
          snapshot: {
            ...sample.literature.snapshot,
            ...(sample.literature.snapshot.tags
              ? { tags: [...sample.literature.snapshot.tags] }
              : {}),
          },
        },
      ),
      width: 440,
      height: 190,
      style: { ...sampleStyle },
    };
    const quotes = sample.quotes.slice(0, 2).map((quote, index) => ({
      ...createAcademicNode(
        "quote",
        { x: 520, y: 430 + index * 210 },
        `tutorial-sample-quote-${index + 1}`,
        {
          source: copySource(quote.source),
          snapshot: { ...quote.snapshot },
        },
      ),
      width: 440,
      height: 190,
      style: { ...sampleStyle },
    }));
    nodes.push(literature, ...quotes);

    if (sample.note) {
      const note = {
        ...createAcademicNode(
          "note",
          { x: 1040, y: 650 },
          "tutorial-sample-note",
          {
            content: sample.note.content,
            style: sampleStyle,
            width: 440,
            height: 200,
          },
        ),
        source: copySource(sample.note.source),
        ...(sample.note.sourceSnapshot
          ? { sourceSnapshot: { ...sample.note.sourceSnapshot } }
          : {}),
      };
      nodes.push(note);
      if (quotes[0]) {
        connections.push({
          ...createAcademicConnection(
            "tutorial-sample-supports",
            quotes[0].id,
            note.id,
            "supports",
          ),
          label: labels.supports,
          color: "#2f855a",
          arrow: true,
        });
      }
    }
  }

  // Make room for the navigation hints before the existing reading exercises.
  // Frame members use absolute positions, so move them together with their frame.
  for (const node of nodes) {
    if (node.id !== title.id) node.position.y += 260;
  }
  nodes.splice(
    1,
    0,
    note(
      "tutorial-quick-start",
      0,
      120,
      1080,
      220,
      labels.quickStart,
      labels.quickStartBody,
    ),
    {
      ...createBasicNode("attachment", { x: 1150, y: 120 }, "tutorial-logo"),
      width: 300,
      height: 220,
      data: { title: "Scholar Sketch", image: tutorialLogo },
      style: { ...sampleStyle },
    },
  );

  return {
    version: CANVAS_DOCUMENT_VERSION,
    nodes,
    connections,
    viewport: { x: 40, y: 70, zoom: 0.5 },
  };
}

function copySource<Source extends { library: object }>(
  source: Source,
): Source {
  return { ...source, library: { ...source.library } };
}
