import { createContext, useCallback, useContext, useRef, ReactNode } from 'react';
import { api } from '@/lib/api';
import type { ViralTemplateTask } from '@/types/viralTemplate';

type SetTasks = React.Dispatch<React.SetStateAction<ViralTemplateTask[]>>;

interface RegistryEntry {
  tasksRef: React.MutableRefObject<ViralTemplateTask[]>;
  setTasks: SetTasks;
}

interface ApplyOptions {
  baseKey: string;
  url: string;
  taskIds: number[];
  /** Scene indices to write `${baseKey}_${idx}` to. If omitted, writes plain baseKey. */
  sceneIndices?: number[];
}

interface ViralTasksContextValue {
  register: (jobId: number, entry: RegistryEntry) => void;
  unregister: (jobId: number) => void;
  /** Snapshot of every task across every registered job (flat list). */
  getAllTasks: () => ViralTemplateTask[];
  /** Apply image url to the named task IDs across all jobs. Persists to DB. */
  applyToTasks: (opts: ApplyOptions) => void;
}

const ViralTasksContext = createContext<ViralTasksContextValue | null>(null);

export function ViralTasksProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<Map<number, RegistryEntry>>(new Map());

  const register = useCallback((jobId: number, entry: RegistryEntry) => {
    registryRef.current.set(jobId, entry);
  }, []);

  const unregister = useCallback((jobId: number) => {
    registryRef.current.delete(jobId);
  }, []);

  const getAllTasks = useCallback((): ViralTemplateTask[] => {
    const all: ViralTemplateTask[] = [];
    for (const { tasksRef } of registryRef.current.values()) {
      all.push(...tasksRef.current);
    }
    return all;
  }, []);

  const applyToTasks = useCallback((opts: ApplyOptions) => {
    const { baseKey, url, taskIds, sceneIndices } = opts;
    const keys = sceneIndices && sceneIndices.length > 0
      ? sceneIndices.map((i) => `${baseKey}_${i}`)
      : [baseKey];
    const idSet = new Set(taskIds);

    for (const [jobId, { tasksRef, setTasks }] of registryRef.current.entries()) {
      const matching = tasksRef.current.filter((t) => idSet.has(t.id));
      if (matching.length === 0) continue;

      // Optimistic local update
      setTasks((prev) =>
        prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          const newVars: Record<string, any> = { ...(t.task_variables || {}) };
          for (const k of keys) newVars[k] = url;
          return { ...t, task_variables: newVars };
        })
      );

      // Persist to DB so a refresh keeps the change
      for (const t of matching) {
        const newVars: Record<string, any> = { ...(t.task_variables || {}) };
        for (const k of keys) newVars[k] = url;
        api.updateViralTask(jobId, t.id, { task_variables: newVars }).catch((err) => {
          console.error('[ViralTasks] Persist task_variables failed:', err);
        });
      }
    }
  }, []);

  return (
    <ViralTasksContext.Provider value={{ register, unregister, getAllTasks, applyToTasks }}>
      {children}
    </ViralTasksContext.Provider>
  );
}

export function useViralTasks() {
  return useContext(ViralTasksContext);
}
