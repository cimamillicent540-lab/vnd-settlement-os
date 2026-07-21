import type { LucideIcon } from "lucide-react";

export function PageHeading({ title, subtitle, actions }: { title:string; subtitle:string; actions?:React.ReactNode }) {
  return <div className="page-heading"><div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>{actions && <div className="actions">{actions}</div>}</div>;
}

export function KpiCard({ label, value, note, icon:Icon, color = "#155eef" }: { label:string; value:string; note:React.ReactNode; icon:LucideIcon; color?:string }) {
  return <div className="kpi-card" style={{"--accent":color} as React.CSSProperties}><div className="kpi-head"><span>{label}</span><span className="kpi-icon"><Icon size={14}/></span></div><div className="kpi-value">{value}</div><div className="kpi-note">{note}</div></div>;
}

export function Pagination({ total, label = "条记录" }: { total:number; label?:string }) {
  return <div className="pagination"><span>共 {total.toLocaleString("en-US")} {label} · 每页 20 条</span><div className="page-buttons"><button className="page-button">‹</button><button className="page-button active">1</button><button className="page-button">2</button><button className="page-button">3</button><button className="page-button">›</button></div></div>;
}
