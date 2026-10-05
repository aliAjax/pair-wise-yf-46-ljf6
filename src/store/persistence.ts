import type { RundownDoc } from "../types";

const KEY = "pair-wise-yf-46/doc";

/** 以 localStorage 充当服务端权威文档：读最新快照、条件写入（先保存者赢） */

export function readDoc(): RundownDoc | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RundownDoc;
  } catch {
    return null;
  }
}

export function writeDoc(doc: RundownDoc) {
  localStorage.setItem(KEY, JSON.stringify(doc));
}

export function hydrateOrSeed(seed: RundownDoc): RundownDoc {
  const existing = readDoc();
  if (existing && Array.isArray(existing.items)) return existing;
  writeDoc(seed);
  return structuredClone(seed);
}
