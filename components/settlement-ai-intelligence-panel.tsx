"use client";

import { useRef, useState } from "react";
import { BrainCircuit, LoaderCircle, ShieldCheck } from "lucide-react";

import { authorizedFetch } from "@/lib/authorized-fetch";

interface ClaimView {
  claim_id: string;
  claim_text: string;
  deterministic_result_paths: string[];
  evidence_ids: string[];
}

interface RecommendationView {
  recommendation_id: string;
  title: string;
  statement: string;
  human_review_request: string;
  evidence_ids: string[];
}

interface AiResultView {
  status: string;
  safe_message: string;
  recommendation_id: string | null;
  snapshot_id: string | null;
  input_digest: string | null;
  calculation_result_digest: string | null;
  recommendation_contract_version: string;
  created_at: string | null;
  evidence_refs: string[];
  limitations: string[];
  attempts: number;
  as_of: string | null;
  data_cutoffs: Array<{
    source_key: string;
    cutoff_at: string | null;
    freshness_status: string;
  }>;
  provider: string;
  model: string;
  model_revision: string | null;
  prompt_version: string;
  prompt_digest: string;
  token_usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };
  validation_issues: Array<{
    code: string;
    path: string;
    message: string;
  }>;
  recommendation_snapshot: {
    fact_summary: ClaimView[];
    risk_summary: ClaimView[];
    recommendations: RecommendationView[];
    confidence: { final_score: string; band: string; reason_codes: string[] };
    limitations: string[];
    evidence_chain: {
      steps: Array<{ step: string; status: string; codes: string[] }>;
    };
  } | null;
  mode: "SHADOW";
  shadow_guard: Record<string, false>;
}

function claimsFor(claims: ClaimView[], prefix: string) {
  return claims.filter((claim) =>
    claim.deterministic_result_paths.some((path) => path.startsWith(prefix)),
  );
}

function ClaimList({ claims, empty }: { claims: ClaimView[]; empty: string }) {
  if (claims.length === 0) return <p className="ai-mvp-empty">{empty}</p>;
  return (
    <ul className="ai-mvp-list">
      {claims.map((claim) => (
        <li key={claim.claim_id}>{claim.claim_text}</li>
      ))}
    </ul>
  );
}

export function SettlementAiIntelligencePanel() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResultView | null>(null);
  const [error, setError] = useState("");

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await authorizedFetch(
        "/api/settlement-intelligence/ai",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        },
      );
      const body = (await response.json()) as AiResultView & {
        message?: string;
      };
      if (!response.ok) throw new Error(body.message ?? "AI生成失败");
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI生成失败");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const snapshot = result?.recommendation_snapshot;
  const factClaims = snapshot?.fact_summary ?? [];
  const executive = factClaims.filter(
    (claim) => claim.deterministic_result_paths.length === 0,
  );
  const evidenceCount = new Set(
    [
      ...factClaims,
      ...(snapshot?.risk_summary ?? []),
      ...(snapshot?.recommendations ?? []),
    ].flatMap((item) => item.evidence_ids),
  ).size;

  return (
    <section className="ai-mvp-panel">
      <header className="ai-mvp-header">
        <div>
          <span className="ai-mvp-eyebrow">CONTROLLED AI · READ ONLY</span>
          <h2>Settlement AI Intelligence</h2>
          <p>
            人工触发、确定性数据输入、验证通过后仅在内存展示；不保存、不执行。
          </p>
        </div>
        <button
          className="button button-primary"
          type="button"
          disabled={busy}
          onClick={generate}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <BrainCircuit size={15} />}
          {busy ? "正在验证…" : "Generate AI Intelligence"}
        </button>
      </header>

      <div className="alert alert-info ai-mvp-shadow">
        <ShieldCheck size={16} />
        <div>
          <strong>Shadow Mode</strong>
          所有自动补U、付款、报价修改、交易、通道切换、第三方提交和审批能力均关闭。
        </div>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {result ? (
        <>
          <div className={`alert ${result.status === "READY" ? "alert-info" : "alert-warning"}`}>
            <div>
              <strong>{result.status}</strong>
              {result.safe_message}
            </div>
          </div>
          {result.validation_issues.length > 0 ? (
            <div className="ai-mvp-validation">
              <strong>Validation Failed</strong>
              {result.validation_issues.map((issue) => (
                <p key={`${issue.code}:${issue.path}`}>
                  {issue.code} · {issue.path} · {issue.message}
                </p>
              ))}
            </div>
          ) : null}
          {snapshot ? (
            <div className="ai-mvp-grid">
              <article><h3>Executive Summary</h3><ClaimList claims={executive.length ? executive : factClaims.slice(0, 3)} empty="无摘要" /></article>
              <article><h3>Liquidity</h3><ClaimList claims={claimsFor(factClaims, "liquidity_result.")} empty="无流动性说明" /></article>
              <article><h3>Profit</h3><ClaimList claims={claimsFor(factClaims, "profit_result.")} empty="无利润说明" /></article>
              <article><h3>FX</h3><ClaimList claims={claimsFor(factClaims, "fx_result.")} empty="无汇率说明" /></article>
              <article><h3>Risks</h3><ClaimList claims={snapshot.risk_summary} empty="未输出风险" /></article>
              <article>
                <h3>Human Review Notes</h3>
                {snapshot.recommendations.length ? (
                  <ul className="ai-mvp-list">
                    {snapshot.recommendations.map((item) => (
                      <li key={item.recommendation_id}><strong>{item.title}</strong> — {item.human_review_request}</li>
                    ))}
                  </ul>
                ) : <p className="ai-mvp-empty">无人工复核备注</p>}
              </article>
            </div>
          ) : null}
          <div className="ai-mvp-meta">
            <span>Confidence：{snapshot ? `${snapshot.confidence.final_score} · ${snapshot.confidence.band}` : "—"}</span>
            <span>Evidence：{evidenceCount}</span>
            <span>数据截止：{result.as_of ?? "—"}</span>
            <span>Prompt：{result.prompt_version} · {result.prompt_digest}</span>
            <span>Model：{result.model} · {result.model_revision ?? "—"}</span>
            <span>Contract：{result.recommendation_contract_version}</span>
            <span>Created：{result.created_at ?? "—"}</span>
            <span>Tokens：{result.token_usage.total_tokens ?? "—"}</span>
            <span>Attempts：{result.attempts}</span>
          </div>
          {result.data_cutoffs.length ? (
            <details className="ai-mvp-cutoffs">
              <summary>数据来源与 freshness</summary>
              {result.data_cutoffs.map((item) => (
                <p key={item.source_key}>{item.source_key} · {item.cutoff_at ?? "无截止时间"} · {item.freshness_status}</p>
              ))}
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
