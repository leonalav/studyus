import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getDb } from "../db/database";
import {
  deleteCurriculumSource,
  getCurriculumTree,
  ingestPdfFile,
  renameCurriculumSource,
  type CurriculumNodeRecord,
  type CurriculumSourceRecord,
} from "../lib/curriculum";
import type { SubjectKey } from "../data/curriculum";

export interface StoredCurriculum extends CurriculumSourceRecord {
  subject: SubjectKey | "unsorted";
  nodes: CurriculumNodeRecord[];
}

export function guessCurriculumSubject(name: string): StoredCurriculum["subject"] {
  const value = name.toLowerCase();
  if (/calc|algebra|geometry|trig|math|deriv|integral|function/.test(value)) return "math";
  if (/bio|cell|genet|organism|anatom/.test(value)) return "biology";
  if (/chem|atom|mole|reaction|organic/.test(value)) return "chemistry";
  if (/phys|mechanic|force|grav|orbit|wave|optics/.test(value)) return "physics";
  if (/program|algorithm|python|java|code|computer|cs/.test(value)) return "programming";
  return "unsorted";
}

interface CurriculumContextValue {
  curricula: StoredCurriculum[];
  refresh: () => Promise<void>;
  addFiles: (files: FileList | File[]) => Promise<StoredCurriculum[]>;
  renameCurriculum: (id: string, name: string) => Promise<void>;
  deleteCurriculum: (id: string) => Promise<void>;
}

const CurriculumContext = createContext<CurriculumContextValue | null>(null);

export function CurriculumProvider({ children }: { children: ReactNode }) {
  const [curricula, setCurricula] = useState<StoredCurriculum[]>([]);

  const refresh = async () => {
    const db = await getDb();
    const result = db.exec("SELECT id, name, hash, page_count, has_outline, extraction_status, created_at FROM curriculum_sources ORDER BY created_at DESC;");
    const sources: CurriculumSourceRecord[] = (result[0]?.values ?? []).map((row) => ({
      id: String(row[0]), name: String(row[1]), hash: String(row[2]), pageCount: Number(row[3]),
      hasOutline: Boolean(row[4]), extractionStatus: row[5] as CurriculumSourceRecord["extractionStatus"], createdAt: String(row[6]),
    }));
    const loaded = await Promise.all(sources.map(async (source) => ({ ...source, subject: guessCurriculumSubject(source.name), nodes: await getCurriculumTree(source.id) })));
    setCurricula(loaded);
  };

  useEffect(() => { void refresh(); }, []);

  const addFiles = async (files: FileList | File[]) => {
    const added: StoredCurriculum[] = [];
    for (const file of Array.from(files)) {
      const source = await ingestPdfFile(file);
      added.push({ ...source, subject: guessCurriculumSubject(source.name), nodes: await getCurriculumTree(source.id) });
    }
    await refresh();
    return added;
  };

  const renameCurriculum = async (id: string, name: string) => {
    await renameCurriculumSource(id, name);
    await refresh();
  };

  const deleteCurriculum = async (id: string) => {
    await deleteCurriculumSource(id);
    await refresh();
  };

  const value = useMemo(
    () => ({ curricula, refresh, addFiles, renameCurriculum, deleteCurriculum }),
    [curricula]
  );
  return <CurriculumContext.Provider value={value}>{children}</CurriculumContext.Provider>;
}

export function useCurricula() {
  const value = useContext(CurriculumContext);
  if (!value) throw new Error("useCurricula must be used inside CurriculumProvider");
  return value;
}
