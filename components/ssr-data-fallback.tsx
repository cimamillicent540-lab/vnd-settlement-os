import { Info, ShieldCheck } from "lucide-react";

import { PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import type { ServerDataFailureCode } from "@/lib/server-data";

export function SsrDataFallback({
  title,
  subtitle,
  failureCode,
}: {
  title: string;
  subtitle: string;
  failureCode: ServerDataFailureCode;
}) {
  const message =
    failureCode === "SUPABASE_QUERY_FAILED"
      ? "Supabase 查询未能在安全的 SSR 时间预算内完成。请稍后刷新；系统没有用旧数据替代当前结果。"
      : "Cloudflare 运行环境尚未完成 Supabase 服务端配置，请检查运行时变量后重试。";

  return (
    <>
      <PageHeading
        title={title}
        subtitle={subtitle}
        actions={<Badge variant="amber">DEGRADED READ-ONLY</Badge>}
      />
      <div className="alert alert-warning settlement-shadow-alert">
        <Info size={17} />
        <div>
          <strong>实时数据暂不可用</strong>
          {message}
        </div>
      </div>
      <div className="alert alert-info">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode 保持生效</strong>
          未执行自动补U、自动付款、自动报价或自动交易。
        </div>
      </div>
    </>
  );
}
