import DeskSettings from "../components/mesa-v3/DeskSettings";
import Office, { statusName } from "../components/mesa-v3/Office";
import AgentDrawer from "../components/mesa-v3/AgentDrawer";
import { useMarket, MarketScreen, Ranking } from "../components/mesa-v3/market";
import "../components/mesa-v3/mesa.css";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import Sidebar from "../components/Sidebar";
import OfficeView from "../components/OfficeView";
import OperationsMonitor from "../components/OperationsMonitor";
import TaskBoard from "../components/TaskBoard";
import AgentManager from "../components/AgentManager";
import SkillsLibrary from "../components/SkillsLibrary";
import SettingsPanel from "../components/SettingsPanel";
import { I18nProvider } from "../i18n";
import type {
  Agent,
  CeoOfficeCall,
  CliStatusMap,
  CompanyStats,
  CompanySettings,
  CrossDeptDelivery,
  Department,
  MeetingPresence,
  SubAgent,
  SubTask,
  Task,
  WorkflowPackKey,
} from "../types";
import type { UpdateStatus } from "../api";
import type { OAuthCallbackResult, RoomThemeMap, View } from "./types";
import AppHeaderBar from "./AppHeaderBar";
import {
  buildOfficePackStarterAgents,
  buildOfficePackPresentation,
  getOfficePackRoomThemes,
  listOfficePackOptions,
  normalizeOfficeWorkflowPack,
  resolveOfficePackSeedProvider,
} from "./office-workflow-pack";
import { resolvePackAgentViews, resolvePackDepartmentsForDisplay } from "./office-pack-display";
import { applyOfficePackToTaskInput, filterTasksByOfficePack, type TaskCreateInput } from "./task-workflow-pack";

interface AppMainLayoutLabels {
  uiLanguage: string;
  viewTitle: string;
  announcementLabel: string;
  roomManagerLabel: string;
  roomManagerDepartments: { id: string; name: string }[];
  reportLabel: string;
  tasksPrimaryLabel: string;
  agentStatusLabel: string;
  decisionLabel: string;
  autoUpdateNoticeVisible: boolean;
  autoUpdateNoticeTitle: string;
  autoUpdateNoticeHint: string;
  autoUpdateNoticeActionLabel: string;
  autoUpdateNoticeContainerClass: string;
  autoUpdateNoticeTextClass: string;
  autoUpdateNoticeHintClass: string;
  autoUpdateNoticeButtonClass: string;
  effectiveUpdateStatus: UpdateStatus | null;
  updateBannerVisible: boolean;
  updateReleaseUrl: string;
  updateTitle: string;
  updateHint: string;
  updateReleaseLabel: string;
  updateDismissLabel: string;
  updateTestModeHint: string;
}

interface AppMainLayoutProps {
  connected: boolean;
  view: View;
  setView: (view: View) => void;
  departments: Department[];
  agents: Agent[];
  stats: CompanyStats | null;
  tasks: Task[];
  subtasks: SubTask[];
  subAgents: SubAgent[];
  meetingPresence: MeetingPresence[];
  settings: CompanySettings;
  cliStatus: CliStatusMap | null;
  oauthResult: OAuthCallbackResult | null;
  labels: AppMainLayoutLabels;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  mobileHeaderMenuOpen: boolean;
  setMobileHeaderMenuOpen: (open: boolean) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  decisionInboxLoading: boolean;
  decisionInboxCount: number;
  activeMeetingTaskId: string | null;
  unreadAgentIds: Set<string>;
  crossDeptDeliveries: CrossDeptDelivery[];
  ceoOfficeCalls: CeoOfficeCall[];
  customRoomThemes: RoomThemeMap;
  activeRoomThemeTargetId: string | null;
  onCrossDeptDeliveryProcessed: (id: string) => void;
  onCeoOfficeCallProcessed: (id: string) => void;
  onOpenActiveMeetingMinutes: (taskId: string) => void;
  onSelectAgent: (agent: Agent) => void;
  onChatWithAgent?: (agent: Agent) => void;
  onSelectDepartment: (department: Department) => void;
  onCreateTask: (input: {
    title: string;
    description?: string;
    department_id?: string;
    task_type?: string;
    priority?: number;
    project_id?: string;
    project_path?: string;
    assigned_agent_id?: string;
    workflow_pack_key?: WorkflowPackKey;
  }) => Promise<void>;
  onUpdateTask: (id: string, data: Partial<Task>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onAssignTask: (taskId: string, agentId: string) => Promise<void>;
  onRunTask: (id: string) => Promise<void>;
  onStopTask: (id: string) => Promise<void>;
  onPauseTask: (id: string) => Promise<void>;
  onResumeTask: (id: string) => Promise<void>;
  onOpenTerminal: (taskId: string) => void;
  onOpenMeetingMinutes: (taskId: string) => void;
  onAgentsChange: () => void;
  activeOfficeWorkflowPack: WorkflowPackKey;
  onChangeOfficeWorkflowPack: (packKey: WorkflowPackKey) => void;
  onSaveSettings: (settings: CompanySettings) => Promise<void>;
  onRefreshCli: () => Promise<void>;
  onOauthResultClear: () => void;
  onOpenDecisionInbox: () => void;
  onOpenAgentStatus: () => void;
  onOpenReportHistory: () => void;
  onOpenAnnouncement: () => void;
  onOpenRoomManager: () => void;
  onDismissAutoUpdateNotice: () => Promise<void>;
  onDismissUpdate: () => void;
  officePackBootstrappingLabel?: string | null;
  children?: ReactNode;
}

export default function AppMainLayout({
  connected,
  view,
  setView,
  departments,
  agents,
  tasks,
  subtasks,
  subAgents,
  meetingPresence,
  settings,
  cliStatus,
  oauthResult,
  labels,
  mobileNavOpen,
  setMobileNavOpen,
  mobileHeaderMenuOpen,
  setMobileHeaderMenuOpen,
  theme,
  toggleTheme,
  decisionInboxLoading,
  decisionInboxCount,
  activeMeetingTaskId,
  unreadAgentIds,
  crossDeptDeliveries,
  ceoOfficeCalls,
  customRoomThemes,
  activeRoomThemeTargetId,
  onCrossDeptDeliveryProcessed,
  onCeoOfficeCallProcessed,
  onOpenActiveMeetingMinutes,
  onSelectAgent,
  onChatWithAgent,
  onSelectDepartment,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onAssignTask,
  onRunTask,
  onStopTask,
  onPauseTask,
  onResumeTask,
  onOpenTerminal,
  onOpenMeetingMinutes,
  onAgentsChange,
  activeOfficeWorkflowPack,
  onChangeOfficeWorkflowPack,
  onSaveSettings,
  onRefreshCli,
  onOauthResultClear,
  onOpenDecisionInbox,
  onOpenAgentStatus,
  onOpenReportHistory,
  onOpenAnnouncement,
  onOpenRoomManager,
  onDismissAutoUpdateNotice,
  onDismissUpdate,
  officePackBootstrappingLabel,
  children,
}: AppMainLayoutProps) {
  const uiLanguage =
    labels.uiLanguage === "ko" || labels.uiLanguage === "ja" || labels.uiLanguage === "zh" ? labels.uiLanguage : "en";
  const officePackKey = normalizeOfficeWorkflowPack(activeOfficeWorkflowPack);
  const officePackOptions = useMemo(() => listOfficePackOptions(uiLanguage), [uiLanguage]);
  const officePackLabel =
    labels.uiLanguage === "ko"
      ? "오피스 팩"
      : labels.uiLanguage === "ja"
        ? "オフィスパック"
        : labels.uiLanguage === "zh"
          ? "办公室包"
          : "Office Pack";
  const officePackBootstrappingMessage = useMemo(() => {
    if (!officePackBootstrappingLabel) return null;
    if (uiLanguage === "ko") return `${officePackBootstrappingLabel} 오피스 팩 배치중...`;
    if (uiLanguage === "ja") return `${officePackBootstrappingLabel} オフィスパックを配置中...`;
    if (uiLanguage === "zh") return `${officePackBootstrappingLabel} 办公室包部署中...`;
    return `Deploying ${officePackBootstrappingLabel} office pack...`;
  }, [officePackBootstrappingLabel, uiLanguage]);
  const generatedOfficePresentation = useMemo(
    () =>
      buildOfficePackPresentation({
        packKey: officePackKey,
        locale: uiLanguage,
        departments,
        agents,
        customRoomThemes,
      }),
    [officePackKey, uiLanguage, departments, agents, customRoomThemes],
  );

  const activePackProfile =
    officePackKey === "development" ? null : (settings.officePackProfiles?.[officePackKey] ?? null);

  const seededPackAgents = useMemo(() => {
    if (officePackKey === "development") return [] as Agent[];
    if (activePackProfile?.agents?.length) return activePackProfile.agents;
    const drafts = buildOfficePackStarterAgents({
      packKey: officePackKey,
      departments: generatedOfficePresentation.departments,
      targetCount: 8,
      locale: uiLanguage,
    });
    const now = Date.now();
    return drafts.map((draft, index) => ({
      id: `${officePackKey}-seed-${index + 1}`,
      name: draft.name,
      name_ko: draft.name_ko,
      name_ja: draft.name_ja,
      name_zh: draft.name_zh,
      department_id: draft.department_id,
      role: draft.role,
      acts_as_planning_leader: draft.acts_as_planning_leader,
      cli_provider: resolveOfficePackSeedProvider({
        packKey: officePackKey,
        departmentId: draft.department_id,
        role: draft.role,
        seedIndex: index + 1,
        seedOrderInDepartment: draft.seed_order_in_department,
      }),
      avatar_emoji: draft.avatar_emoji,
      sprite_number: draft.sprite_number,
      personality: draft.personality,
      status: "idle" as const,
      current_task_id: null,
      stats_tasks_done: 0,
      stats_xp: 0,
      created_at: now,
    }));
  }, [activePackProfile?.agents, generatedOfficePresentation.departments, officePackKey, uiLanguage]);

  const packProfileDepartments =
    officePackKey === "development"
      ? null
      : (activePackProfile?.departments ?? generatedOfficePresentation.departments);
  const packProfileAgents = officePackKey === "development" ? null : (activePackProfile?.agents ?? seededPackAgents);

  const isHydratedOfficePack = useMemo(() => {
    if (officePackKey === "development") return false;
    const hydrated = settings.officePackHydratedPacks;
    if (!Array.isArray(hydrated)) return false;
    return hydrated.map((value) => String(value ?? "").trim()).includes(officePackKey);
  }, [officePackKey, settings.officePackHydratedPacks]);

  const displayDepartments = useMemo(
    () =>
      resolvePackDepartmentsForDisplay({
        packKey: officePackKey,
        globalDepartments: departments,
        packDepartments: packProfileDepartments,
        preferPackProfile: !isHydratedOfficePack,
      }),
    [departments, isHydratedOfficePack, officePackKey, packProfileDepartments],
  );

  const { scopedAgents: officeScopedAgents, mergedAgents: displayAgents } = useMemo(
    () =>
      resolvePackAgentViews({
        packKey: officePackKey,
        globalAgents: agents,
        packAgents: packProfileAgents,
      }),
    [agents, officePackKey, packProfileAgents],
  );

  const managerDepartments =
    officePackKey === "development"
      ? departments
      : isHydratedOfficePack
        ? displayDepartments
        : (activePackProfile?.departments ?? generatedOfficePresentation.departments);

  const managerAgents =
    officePackKey === "development"
      ? agents
      : isHydratedOfficePack
        ? officeScopedAgents
        : (activePackProfile?.agents ?? seededPackAgents);

  const officePresentation = useMemo(() => {
    if (officePackKey === "development") {
      // The initial desk shares a single operations room. Hide unused rooms
      // without deleting departments or altering agent records.
      const presentation = generatedOfficePresentation;
      const occupiedIds = new Set(presentation.agents.map((agent) => agent.department_id));
      const occupiedRooms = presentation.departments.filter((department) => occupiedIds.has(department.id));
      const operationsRoom = presentation.departments.find((department) => department.id === "operations");
      const visibleRooms =
        occupiedRooms.length > 0
          ? occupiedRooms
          : operationsRoom
            ? [operationsRoom]
            : presentation.departments.slice(0, 1);
      return {
        ...presentation,
        departments: visibleRooms.map((department) =>
          department.id === "operations"
            ? {
                ...department,
                name: "Mesa de Operações",
                name_ko: "Mesa de Operações",
                name_ja: "Mesa de Operações",
                name_zh: "Mesa de Operações",
              }
            : department,
        ),
      };
    }
    return {
      departments: displayDepartments,
      agents: officeScopedAgents,
      roomThemes: {
        ...customRoomThemes,
        ...getOfficePackRoomThemes(officePackKey),
      },
    };
  }, [customRoomThemes, displayDepartments, generatedOfficePresentation, officePackKey, officeScopedAgents]);

  const tasksForActivePack = useMemo(() => filterTasksByOfficePack(tasks, officePackKey), [tasks, officePackKey]);
  const handleCreateTaskForActivePack = useCallback(
    async (input: TaskCreateInput) => {
      await onCreateTask(applyOfficePackToTaskInput(input, officePackKey));
    },
    [onCreateTask, officePackKey],
  );


  // kept above: pack scoping and persistence; the desk is now the primary interface.
  const [screen,setScreen]=useState<"office"|"market"|"ranking"|"settings">("office");
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const {market,error}=useMarket();
  const visibleAgents=officePresentation.agents;
  const chosen=visibleAgents.find(a=>a.id===selectedId);
  const select=(id:string)=>{if(visibleAgents.some(a=>a.id===id))setSelectedId(id);};
  const navigate=(next:typeof screen)=>{setScreen(next);setView("office");};
  const legacy=view==="tasks"||view==="skills"||view==="agents"||view==="settings";
  return (
    <I18nProvider language={labels.uiLanguage}>
      <div className="mv3-shell" lang="pt-BR">
        <header className="mv3-header"><span className="mv3-brand">MESA DE OPERAÇÕES</span><nav aria-label="Navegação principal">
          {([["office","Escritório"],["market","Mercado"],["ranking","Desempenho"],["settings","Configurações"]] as const).map(([id,label])=><button key={id} aria-pressed={screen===id} onClick={()=>navigate(id)}>{label}</button>)}
        </nav><span className="mv3-connection">{connected?"● Servidor conectado":"○ Servidor desconectado"}</span></header>
        <main className="mv3-content">
          {screen==="office"&&!legacy&&<Office agents={visibleAgents} tasks={tasksForActivePack} meetings={meetingPresence} deliveries={crossDeptDeliveries} calls={ceoOfficeCalls} market={market} onSelect={a=>select(a.id)} onMeeting={()=>activeMeetingTaskId?onOpenActiveMeetingMinutes(activeMeetingTaskId):onOpenReportHistory()} onDeliveryDone={onCrossDeptDeliveryProcessed} onCallDone={onCeoOfficeCallProcessed} onMarket={()=>navigate("market")}/>}
          {screen==="market"&&!legacy&&<MarketScreen market={market} error={error} onSelect={select}/>}
          {screen==="ranking"&&!legacy&&<div className="mv3-page"><h2>Desempenho</h2>{error&&<p role="alert">Dados de mercado temporariamente indisponíveis.</p>}<Ranking market={market} onSelect={select}/><h3>Atividade operacional</h3><table><thead><tr><th>Agente</th><th>Status</th><th>Tarefas concluídas</th></tr></thead><tbody>{visibleAgents.map(a=><tr key={a.id}><td><button className="mv3-link" onClick={()=>select(a.id)}>{a.name}</button></td><td>{statusName(a)}</td><td>{a.stats_tasks_done}</td></tr>)}</tbody></table></div>}
          {screen==="settings"&&!legacy&&<DeskSettings agents={visibleAgents} onSelect={select} onAdvanced={()=>setView("settings")} onDecisions={onOpenDecisionInbox} onReports={onOpenReportHistory} onAnnouncement={onOpenAnnouncement}/>}
          {legacy&&<div className="mv3-legacy"><div className="mv3-legacy-nav"><button onClick={()=>navigate("settings")}>Voltar à Mesa</button><button onClick={()=>setView("agents")}>Equipe</button><button onClick={()=>setView("tasks")}>Tarefas</button><button onClick={()=>setView("skills")}>Skills</button><button onClick={()=>setView("settings")}>Conexões gerais</button><button onClick={onOpenDecisionInbox}>Decisões ({decisionInboxCount})</button><button onClick={onOpenReportHistory}>Relatórios</button></div>
            {view==="tasks"&&<TaskBoard tasks={tasksForActivePack} agents={displayAgents} departments={displayDepartments} subtasks={subtasks} onCreateTask={handleCreateTaskForActivePack} onUpdateTask={onUpdateTask} onDeleteTask={onDeleteTask} onAssignTask={onAssignTask} onRunTask={onRunTask} onStopTask={onStopTask} onPauseTask={onPauseTask} onResumeTask={onResumeTask} onOpenTerminal={onOpenTerminal} onOpenMeetingMinutes={onOpenMeetingMinutes}/>}
            {view==="agents"&&<AgentManager agents={managerAgents} departments={managerDepartments} onAgentsChange={onAgentsChange} activeOfficeWorkflowPack={officePackKey} dbBackedOfficePack={isHydratedOfficePack} onSaveOfficePackProfile={async(packKey,profile)=>{if(packKey==="development")return;await onSaveSettings({...settings,officePackProfiles:{...(settings.officePackProfiles??{}),[packKey]:profile}});}}/>}
            {view==="skills"&&<SkillsLibrary agents={agents}/>}
            {view==="settings"&&<SettingsPanel settings={settings} cliStatus={cliStatus} onSave={next=>void onSaveSettings(next)} onRefreshCli={()=>void onRefreshCli()} oauthResult={oauthResult} onOauthResultClear={onOauthResultClear}/>}
          </div>}
        </main>
        {chosen&&<AgentDrawer key={chosen.id} agent={chosen} agents={visibleAgents} tasks={tasksForActivePack} onClose={()=>setSelectedId(null)} onUpdated={onAgentsChange} onChat={()=>{setSelectedId(null);(onChatWithAgent??onSelectAgent)(chosen);}} onAssign={()=>{setSelectedId(null);setView("tasks");}} onLogs={id=>{setSelectedId(null);onOpenTerminal(id);}} onSkills={()=>{setSelectedId(null);setView("skills");}}/>}
        {children}
      </div>
    </I18nProvider>
  );
}
