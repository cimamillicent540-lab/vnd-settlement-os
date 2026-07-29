export const SSR_PAGE_BUDGET_MS = 12_000;
export const SUPABASE_REQUEST_BUDGET_MS = 5_000;
export const SSR_SUCCESS_CACHE_MS = 2_000;
export const SSR_FAILURE_CACHE_MS = 500;

export const SSR_QUERY_PLAN = {
  settlementIntelligence: {
    plannedQueries: 10,
    dependencyWaves: 1,
  },
  settlementLearning: {
    plannedQueries: 4,
    dependencyWaves: 3,
  },
  approvalCenter: {
    plannedQueries: 4,
    dependencyWaves: 2,
  },
  settlementDailyReport: {
    plannedQueries: 24,
    dependencyWaves: 2,
  },
} as const;

export class SsrPageBudgetExceededError extends Error {
  constructor(readonly page: string) {
    super(`SSR_PAGE_BUDGET_EXCEEDED:${page}`);
    this.name = "SsrPageBudgetExceededError";
  }
}

type SsrReadCacheEntry = {
  expiresAt: number;
  promise: Promise<unknown>;
};

const cacheKey = Symbol.for("vnd-os.ssr-read-cache");
const sharedScope = globalThis as typeof globalThis & {
  [cacheKey]?: Map<string, SsrReadCacheEntry>;
};
const sharedReadCache =
  sharedScope[cacheKey] ??
  (sharedScope[cacheKey] = new Map<string, SsrReadCacheEntry>());

export async function loadSsrPageData<T>({
  page,
  plannedQueries,
  loader,
  budgetMs = SSR_PAGE_BUDGET_MS,
}: {
  page: string;
  plannedQueries: number;
  loader: () => Promise<T>;
  budgetMs?: number;
}): Promise<T> {
  const startedAt = Date.now();
  let outcome = "READY";
  let cacheStatus = "HIT";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const existing = sharedReadCache.get(page);
  let entry =
    existing && existing.expiresAt > startedAt ? existing : undefined;

  if (!entry) {
    cacheStatus = "MISS";
    const promise = loader();
    const newEntry = {
      expiresAt: Number.POSITIVE_INFINITY,
      promise,
    };
    entry = newEntry;
    sharedReadCache.set(page, newEntry);
    void promise.then(
      () => {
        newEntry.expiresAt = Date.now() + SSR_SUCCESS_CACHE_MS;
      },
      () => {
        newEntry.expiresAt = Date.now() + SSR_FAILURE_CACHE_MS;
      },
    );
  }

  try {
    return await Promise.race([
      entry.promise as Promise<T>,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new SsrPageBudgetExceededError(page));
        }, budgetMs);
      }),
    ]);
  } catch (error) {
    outcome =
      error instanceof SsrPageBudgetExceededError
        ? "DEGRADED_TIMEOUT"
        : "DEGRADED_QUERY_FAILURE";
    if (
      error instanceof SsrPageBudgetExceededError &&
      sharedReadCache.get(page) === entry
    ) {
      sharedReadCache.delete(page);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    console.info("ssr_data_load", {
      page,
      plannedQueries,
      durationMs: Date.now() - startedAt,
      outcome,
      cacheStatus,
    });
  }
}

export async function fetchWithSupabaseBudget(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const timeoutSignal = AbortSignal.timeout(
    SUPABASE_REQUEST_BUDGET_MS,
  );
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  return fetch(input, {
    ...init,
    signal,
  });
}
