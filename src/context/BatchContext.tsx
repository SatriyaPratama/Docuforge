'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/context/AppContext';
import { preValidateFile } from '@/lib/fileConstraints';
import { useParse } from '@/lib/useParse';

export type BatchJobStatus = 'queued' | 'parsing' | 'completed' | 'failed' | 'cancelled';
export interface BatchJob { id: string; file: File; status: BatchJobStatus; error?: string; }
interface BatchContextValue { jobs: BatchJob[]; enqueue(files: File[]): void; remove(id: string): void; pause(): void; resume(): void; paused: boolean; }

const BatchContext = createContext<BatchContextValue | null>(null);

export function BatchProvider({ children }: { children: ReactNode }) {
  const { dispatch } = useApp();
  const { parse, isParsing } = useParse();
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [paused, setPaused] = useState(false);
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const running = useRef(false);

  const enqueue = useCallback((files: File[]) => {
    const next: BatchJob[] = files.map((file) => {
      const error = preValidateFile(file);
      return { id: crypto.randomUUID(), file, status: error ? 'failed' : 'queued', error: error ?? undefined };
    });
    setJobs((current) => [...current, ...next]);
  }, []);

  useEffect(() => {
    if (running.current || paused || isParsing) return;
    const next = jobs.find((job) => job.status === 'queued');
    if (!next) return;
    running.current = true;
    setJobs((current) => current.map((job) => job.id === next.id ? { ...job, status: 'parsing' } : job));
    dispatch({ type: 'SET_FILE', payload: next.file });
    void parse(next.file).then((succeeded) => {
      setJobs((current) => current.map((job) => job.id === next.id ? { ...job, status: succeeded ? 'completed' : 'failed', error: succeeded ? undefined : 'Parsing failed. Retry from the document workspace.' } : job));
    }).finally(() => {
      running.current = false;
      // Re-render after the ref changes so the next queued job is observed.
      setScheduleVersion((version) => version + 1);
    });
  }, [jobs, paused, isParsing, parse, dispatch, scheduleVersion]);

  const remove = useCallback((id: string) => setJobs((current) => current.filter((job) => job.id !== id || job.status === 'parsing')), []);
  return <BatchContext.Provider value={{ jobs, enqueue, remove, pause: () => setPaused(true), resume: () => setPaused(false), paused }}>{children}</BatchContext.Provider>;
}

export function useBatch() {
  const context = useContext(BatchContext);
  if (!context) throw new Error('useBatch must be used within BatchProvider');
  return context;
}
