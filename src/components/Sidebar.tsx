import { useState } from "react";
import type { Department, Agent, CompanySettings } from "../types";
import { useI18n, localeName } from "../i18n";

type View = "office" | "agents" | "dashboard" | "tasks" | "skills" | "settings";

interface SidebarProps {
  currentView: View;
  onChangeView: (v: View) => void;
  departments: Department[];
  agents: Agent[];
  settings: CompanySettings;
  connected: boolean;
}

const NAV_ITEMS: { view: View; icon: string }[] = [
  { view: "office", icon: "◫" },
  { view: "agents", icon: "◎" },
  { view: "tasks", icon: "≡" },
  { view: "dashboard", icon: "▥" },
  { view: "settings", icon: "⚙" },
  { view: "skills", icon: "▤" },
];

export default function Sidebar({ currentView, onChangeView, departments, agents, settings, connected }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { t, locale } = useI18n();
  const workingCount = agents.filter((a) => a.status === "working").length;
  const totalAgents = agents.length;

  const tr = (ko: string, en: string, ja = en, zh = en) => t({ ko, en, ja, zh });

  const navLabels: Record<View, string> = {
    office: "Mesa",
    agents: "Agentes",
    skills: "Biblioteca",
    dashboard: "Indicadores",
    tasks: "Operações",
    settings: "Configurações",
  };

  return (
    <aside
      className={`flex h-full flex-col backdrop-blur-sm transition-all duration-300 ${collapsed ? "w-16" : "w-48"}`}
      style={{ background: "var(--th-bg-sidebar)", borderRight: "1px solid var(--th-border)" }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-3 py-4"
        style={{ borderBottom: "1px solid var(--th-border)", boxShadow: "0 4px 12px rgba(59, 130, 246, 0.06)" }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{ background: "#142a35", border: "1px solid #355763", color: "#77c5be" }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="21"
              height="21"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4v16h16M7 15l4-4 3 2 5-6" />
              <path d="M15 7h4v4" />
            </svg>
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="text-sm font-bold truncate" style={{ color: "var(--th-text-heading)" }}>
                {settings.companyName}
              </div>
              <div className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                Mesa de Operações
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 space-y-0.5 px-2">
        {NAV_ITEMS.filter((item) => item.view !== "skills" || showAdvanced || currentView === "skills").map((item) => (
          <button
            key={item.view}
            onClick={() => onChangeView(item.view)}
            className={`sidebar-nav-item ${
              currentView === item.view ? "active font-semibold shadow-sm shadow-blue-500/10" : ""
            }`}
          >
            <span className="text-base shrink-0">{item.icon}</span>
            {!collapsed && <span>{navLabels[item.view]}</span>}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={showAdvanced}
          title={tr("고급 메뉴", "Advanced tools")}
          onClick={() => setShowAdvanced((value) => !value)}
          className="sidebar-nav-item"
        >
          <span aria-hidden="true">{showAdvanced ? "−" : "+"}</span>
          {!collapsed && <span>{tr("고급 메뉴", "Advanced tools")}</span>}
        </button>
      </nav>

      {/* Department quick stats */}
      {!collapsed && showAdvanced && (
        <div className="px-3 py-2" style={{ borderTop: "1px solid var(--th-border)" }}>
          <div
            className="text-[10px] uppercase font-semibold mb-1.5 tracking-wider"
            style={{ color: "var(--th-text-muted)" }}
          >
            {tr("부서 현황", "Department Status", "部門状況", "部门状态")}
          </div>
          {departments.map((d) => {
            const deptAgents = agents.filter((a) => a.department_id === d.id);
            const working = deptAgents.filter((a) => a.status === "working").length;
            return (
              <div
                key={d.id}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                style={{ color: "var(--th-text-secondary)" }}
              >
                <span>{d.icon}</span>
                <span className="flex-1 truncate">{localeName(locale, d)}</span>
                <span className={working > 0 ? "text-blue-400 font-medium" : ""}>
                  {working}/{deptAgents.length}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Status bar */}
      <div className="px-3 py-2.5" style={{ borderTop: "1px solid var(--th-border)" }}>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          {!collapsed && (
            <div className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
              {connected
                ? tr("연결됨", "Connected", "接続中", "已连接")
                : tr("연결 끊김", "Disconnected", "接続なし", "已断开")}{" "}
              · {workingCount}/{totalAgents} {tr("근무중", "working", "稼働中", "工作中")}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
