export const SSR_PAGE_BUDGET_MS = 12_000;
export const SUPABASE_REQUEST_BUDGET_MS = 5_000;

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
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      loader(),
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
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    console.info("ssr_data_load", {
      page,
      plannedQueries,
      durationMs: Date.now() - startedAt,
      outcome,
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
