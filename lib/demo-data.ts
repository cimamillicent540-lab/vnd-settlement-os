export const topups = [
  { id: "TU-0719-01", executionDate: "2026-07-19", sequence: 1, usdt: "150000", grossVnd: "3938250000", remainingVnd: "1000000000", rate: "26255", precision: "DATE_ONLY", channel: "OTC Desk A", status: "APPROVED" },
  { id: "TU-0719-02", executionDate: "2026-07-19", sequence: 2, usdt: "150000", grossVnd: "3938250000", remainingVnd: "1214500000", rate: "26255", precision: "DATE_ONLY", channel: "OTC Desk A", status: "APPROVED" },
  { id: "TU-0720-01", executionDate: "2026-07-20", sequence: 1, usdt: "250000", grossVnd: "6657000000", remainingVnd: "4478000000", rate: "26628", precision: "DATE_ONLY", channel: "OTC Desk B", status: "APPROVED" },
] as const;

export const importBatches = [
  { id: "IMP-20260721-004", type: "PAYIN", file: "Payin_外卡_20260720.xlsx", rows: 1248, valid: 1229, invalid: 7, duplicate: 12, status: "REVIEW", at: "2026-07-21 08:42 UTC" },
  { id: "IMP-20260721-003", type: "PAYOUT", file: "payout_daily_20260720.csv", rows: 876, valid: 864, invalid: 4, duplicate: 8, status: "COMPLETED", at: "2026-07-21 08:08 UTC" },
  { id: "IMP-20260720-002", type: "PAYIN", file: "Payin_外卡_20260719.xls", rows: 1094, valid: 1091, invalid: 1, duplicate: 2, status: "COMPLETED", at: "2026-07-20 08:37 UTC" },
  { id: "IMP-20260720-001", type: "PAYOUT", file: "payout_daily_20260719.xlsx", rows: 721, valid: 716, invalid: 5, duplicate: 0, status: "COMPLETED", at: "2026-07-20 08:03 UTC" },
] as const;

export const ledgerEntries = [
  { time: "2026-07-21 09:12", type: "PAYIN_INFLOW", source: "PAYIN", ref: "PI-836142", amount: "+285,000,000", balance: "10,946,821,500", confidence: "高" },
  { time: "2026-07-21 08:56", type: "PAYOUT_OUTFLOW", source: "MIXED", ref: "PO-291083", amount: "−120,000,000", balance: "10,661,821,500", confidence: "高" },
  { time: "2026-07-21 08:42", type: "PAYIN_INFLOW", source: "PAYIN", ref: "PI-835911", amount: "+74,500,000", balance: "10,781,821,500", confidence: "中" },
  { time: "2026-07-20 · 日期级", type: "TOPUP_INFLOW", source: "TOPUP", ref: "TU-0720-01", amount: "+6,657,000,000", balance: "10,707,321,500", confidence: "中" },
  { time: "2026-07-20 07:31", type: "PAYOUT_OUTFLOW", source: "MIXED", ref: "PO-290721", amount: "−360,000,000", balance: "4,050,321,500", confidence: "高" },
] as const;

export const poolBuckets = [
  { source: "OPENING", label: "期初余额", value: "1,500,000,000", pct: "13.7%", color: "#64748b", cost: "MISSING" },
  { source: "PAYIN", label: "Payin 资金", value: "2,754,321,500", pct: "25.2%", color: "#155eef", cost: "ESTIMATED" },
  { source: "TOPUP", label: "补U资金", value: "6,692,500,000", pct: "61.1%", color: "#0f9f78", cost: "KNOWN" },
] as const;
