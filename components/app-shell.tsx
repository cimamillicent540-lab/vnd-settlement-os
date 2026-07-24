"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BriefcaseBusiness, Calculator, ChevronDown, CircleHelp, Database, FileInput, FileSpreadsheet, Gauge, PanelLeft, Scale, SearchCheck, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href:"/pool", label:"资金池总览", icon:Gauge },
  { href:"/imports", label:"数据导入", icon:FileInput },
  { href:"/topups", label:"补U批次", icon:Database },
  { href:"/data-quality", label:"数据质量", icon:SearchCheck },
  { href:"/reconciliation", label:"真实数据对账", icon:Scale },
  { href:"/shadow-pricing", label:"影子报价", icon:Calculator },
  { href:"/portfolio", label:"组合回测", icon:BriefcaseBusiness },
  { href:"/payment-export", label:"付款准备", icon:FileSpreadsheet },
];
const titles:Record<string,string> = { "/pool":"VND 资金池", "/imports":"数据导入中心", "/topups":"补U批次", "/data-quality":"数据质量与审计", "/reconciliation":"真实数据对账", "/shadow-pricing":"影子报价", "/portfolio":"组合回测", "/payment-export":"付款准备与风险检查" };

export function AppShell({ children }:{ children:React.ReactNode }) {
  const pathname = usePathname();
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><PanelLeft size={17}/></span><div><div className="brand-title">VND Shadow OS</div><div className="brand-subtitle">PRICING · LIQUIDITY</div></div></div>
      <nav aria-label="主导航"><div className="nav-section-label">OPERATIONS</div>{nav.map(item=><Link key={item.href} href={item.href} className={cn("nav-item",pathname===item.href&&"active")}><item.icon size={16}/><span>{item.label}</span></Link>)}
        <div className="nav-section-label">GOVERNANCE</div><span className="nav-item"><ShieldCheck size={16}/>规则与权限</span>
      </nav>
      <div className="sidebar-footer"><div className="shadow-pill"><span className="pulse-dot"/><div><strong>SHADOW MODE</strong><span>无资金自动执行能力</span></div></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>VND 结算</span><span>/</span><strong>{titles[pathname]??"工作台"}</strong></div><div className="top-actions"><button className="icon-button" aria-label="帮助"><CircleHelp size={15}/></button><button className="icon-button" aria-label="通知"><Bell size={15}/><span className="notify-dot"/></button><div className="user-chip"><div className="avatar">ZL</div><div><div className="user-name">结算管理员</div><div className="user-role">admin · UTC</div></div><ChevronDown size={13} color="#8993a5"/></div></div></header>
      <main className="content">{children}</main>
    </div>
  </div>;
}
