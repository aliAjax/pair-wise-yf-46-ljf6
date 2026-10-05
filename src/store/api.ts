import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { ConflictInfo, RundownItem } from "../types";

const KEY = "pair-wise-yf-46/rundown";

function readAll(): RundownItem[] {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as RundownItem[]) : [];
}

export const rundownApi = createApi({
  reducerPath: "rundownApi",
  baseQuery: fakeBaseQuery(),
  tagTypes: ["Rundown"],
  endpoints: (builder) => ({
    getRundown: builder.query<RundownItem[], void>({
      queryFn: async () => ({ data: readAll() }),
      providesTags: ["Rundown"]
    }),
    /**
     * 保存串联单。两个窗口同时修改同一条目时，版本号大的（先保存的）为准：
     * 若 localStorage 里该条目的版本已超过我方基线版本，说明对方先存了一步，
     * 本次保存整体停止，返回冲突清单，由界面向用户说明。
     */
    saveRundown: builder.mutation<{ ok: true } | { conflict: ConflictInfo[] }, { items: RundownItem[]; baseVersions: Record<string, number> }>({
      queryFn: async ({ items, baseVersions }) => {
        const stored = readAll();
        const conflicts: ConflictInfo[] = [];
        for (const item of items) {
          const saved = stored.find((entry) => entry.id === item.id);
          const base = baseVersions[item.id] ?? 0;
          if (saved && saved.version > base) {
            conflicts.push({ itemId: item.id, title: item.title, storedVersion: saved.version, baseVersion: base });
          }
        }
        if (conflicts.length) return { data: { conflict: conflicts } };
        localStorage.setItem(KEY, JSON.stringify(items));
        return { data: { ok: true } };
      },
      invalidatesTags: ["Rundown"]
    }),
    /** 演示用：模拟另一个岗位窗口先保存了某一条目（版本 +1 并把时长 +1） */
    simulateExternalSave: builder.mutation<{ ok: true }, { itemId: string }>({
      queryFn: async ({ itemId }) => {
        const stored = readAll();
        const item = stored.find((entry) => entry.id === itemId);
        if (item) {
          item.version += 1;
          item.duration += 1;
          localStorage.setItem(KEY, JSON.stringify(stored));
        }
        return { data: { ok: true } };
      }
    })
  })
});

export const { useGetRundownQuery, useSaveRundownMutation, useSimulateExternalSaveMutation } = rundownApi;
