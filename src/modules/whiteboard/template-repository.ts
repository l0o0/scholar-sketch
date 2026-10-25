import { config } from "../../../package.json";
import {
  BUILTIN_NOTE_TEMPLATE_IDS,
  parseNoteTemplate,
  type NoteTemplate,
} from "../../../packages/whiteboard/src/model/note-template";

/** Legacy synchronized key, retained only for local migration. */
export const NOTE_TEMPLATE_SETTING = "bamboo.noteTemplates.v1";
export const NOTE_TEMPLATE_PREF = `${config.prefsPrefix}.noteTemplates`;

export interface TemplateRegistryRecord {
  template?: NoteTemplate;
  deletedAt?: string;
}

export interface TemplateRegistry {
  version: 1;
  records: Record<string, TemplateRegistryRecord>;
}

export interface TemplatePreferencesPort {
  get(key: string, global: boolean): unknown;
  set(key: string, value: string, global: boolean): void;
}

export interface NoteTemplateRepository {
  list(): NoteTemplate[];
  save(template: NoteTemplate): Promise<void>;
  remove(templateId: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createNoteTemplateRepository(options: {
  preferences: TemplatePreferencesPort;
  now?: () => string;
}): NoteTemplateRepository {
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Set<() => void>();
  const read = () => {
    const raw = options.preferences.get(NOTE_TEMPLATE_PREF, true);
    if (raw === undefined || raw === null || raw === "")
      return {
        version: 1 as const,
        records: {} as Record<string, TemplateRegistryRecord>,
      };
    if (typeof raw !== "string")
      throw new Error("Invalid local Note template preference.");
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.records))
      throw new Error("Invalid local Note template registry.");
    const parsed = parseTemplateRegistry(value);
    if (
      Object.keys(parsed.records).length !== Object.keys(value.records).length
    )
      throw new Error("Invalid local Note template record.");
    return parsed;
  };
  const write = (registry: TemplateRegistry) =>
    options.preferences.set(NOTE_TEMPLATE_PREF, JSON.stringify(registry), true);
  const notify = () => listeners.forEach((listener) => listener());

  return {
    list() {
      return Object.values(read().records)
        .map((record) => record.template)
        .filter((template): template is NoteTemplate => Boolean(template))
        .sort(
          (a, b) =>
            (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
              (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
        );
    },
    async save(value) {
      const template = parseNoteTemplate(value);
      if (!template || isBuiltinTemplateId(template.id)) {
        throw new Error("Invalid custom Note template.");
      }
      const registry = read();
      registry.records[template.id] = { template };
      write(registry);
      notify();
    },
    async remove(templateId) {
      if (!templateId || isBuiltinTemplateId(templateId)) return;
      const registry = read();
      registry.records[templateId] = { deletedAt: now() };
      write(registry);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function parseTemplateRegistry(value: unknown): TemplateRegistry {
  const records: Record<string, TemplateRegistryRecord> = {};
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.records)) {
    return { version: 1, records };
  }
  for (const [id, candidate] of Object.entries(value.records)) {
    if (!id || !isRecord(candidate)) continue;
    const template = parseNoteTemplate(candidate.template);
    if (template?.id === id) {
      records[id] = { template };
      continue;
    }
    if (
      typeof candidate.deletedAt === "string" &&
      Number.isFinite(Date.parse(candidate.deletedAt))
    ) {
      records[id] = { deletedAt: candidate.deletedAt };
    }
  }
  return { version: 1, records };
}

function isBuiltinTemplateId(id: string): boolean {
  return Object.values(BUILTIN_NOTE_TEMPLATE_IDS).includes(
    id as (typeof BUILTIN_NOTE_TEMPLATE_IDS)[keyof typeof BUILTIN_NOTE_TEMPLATE_IDS],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

let zoteroRepository: NoteTemplateRepository | undefined;

export function getZoteroNoteTemplateRepository(): NoteTemplateRepository {
  if (zoteroRepository) return zoteroRepository;
  zoteroRepository = createNoteTemplateRepository({
    preferences: {
      get: (key, global) => Zotero.Prefs.get(key, global),
      set: (key, value, global) => Zotero.Prefs.set(key, value, global),
    },
  });
  return zoteroRepository;
}
