import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiProvider, OAuthStatus } from "../api";
import * as api from "../api";
import { localeName, useI18n } from "../i18n";
import type {
  Agent,
  CliModelInfo,
  Department,
  ReasoningLevelOption,
  SubAgent,
  SubTask,
  Task,
  WorkflowPackKey,
} from "../types";
import AgentAvatar from "./AgentAvatar";
import AgentDetailTabContent from "./agent-detail/AgentDetailTabContent";
import AgentSchedule from "./agent-detail/AgentSchedule";
import AgentToolRegistry from "./agent-detail/AgentToolRegistry";
import AgentUsage from "./agent-detail/AgentUsage";
import { CLI_LABELS, oauthAccountLabel, roleLabel, STATUS_CONFIG, statusLabel } from "./agent-detail/constants";

interface AgentDetailProps {
  agent: Agent;
  agents: Agent[];
  department: Department | undefined;
  departments: Department[];
  tasks: Task[];
  subAgents: SubAgent[];
  subtasks: SubTask[];
  activeOfficeWorkflowPack: WorkflowPackKey;
  onClose: () => void;
  onChat: (agent: Agent) => void;
  onAssignTask: (agentId: string) => void;
  onOpenTerminal?: (taskId: string) => void;
  onAgentUpdated?: () => void;
}

const CLI_MODEL_OVERRIDE_PROVIDERS: Agent["cli_provider"][] = ["claude", "codex", "gemini", "opencode", "kimi"];
const CODEX_REASONING_FALLBACK_OPTIONS: ReasoningLevelOption[] = [
  { effort: "low", description: "Faster, lower depth" },
  { effort: "medium", description: "Balanced default" },
  { effort: "high", description: "Higher reasoning depth" },
  { effort: "xhigh", description: "Maximum reasoning depth" },
];

export default function AgentDetail({
  agent,
  agents,
  department,
  departments,
  tasks,
  subAgents,
  subtasks,
  activeOfficeWorkflowPack,
  onClose,
  onChat,
  onAssignTask,
  onOpenTerminal,
  onAgentUpdated,
}: AgentDetailProps) {
  const { t, language } = useI18n();
  const [tab, setTab] = useState<"info" | "tasks" | "alba">("info");
  const [editingCli, setEditingCli] = useState(false);
  const [selectedCli, setSelectedCli] = useState(agent.cli_provider);
  const [selectedOAuthAccountId, setSelectedOAuthAccountId] = useState(agent.oauth_account_id ?? "");
  const [selectedApiProviderId, setSelectedApiProviderId] = useState(agent.api_provider_id ?? "");
  const [selectedApiModel, setSelectedApiModel] = useState(agent.api_model ?? "");
  const [selectedCliModel, setSelectedCliModel] = useState(agent.cli_model ?? "");
  const [selectedCliReasoningLevel, setSelectedCliReasoningLevel] = useState(agent.cli_reasoning_level ?? "");
  const [savingCli, setSavingCli] = useState(false);
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>([]);
  const [apiModels, setApiModels] = useState<string[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [instructionDraft, setInstructionDraft] = useState(agent.personality ?? "");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [cliModels, setCliModels] = useState<Record<string, CliModelInfo[]>>({});
  const [cliModelsLoading, setCliModelsLoading] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [savingPlanningLead, setSavingPlanningLead] = useState(false);
  const [actsAsPlanningLead, setActsAsPlanningLead] = useState(Number(agent.acts_as_planning_leader ?? 0) === 1);

  const agentTasks = tasks.filter((task) => task.assigned_agent_id === agent.id);
  const subtasksByTask = useMemo(() => {
    const grouped: Record<string, SubTask[]> = {};
    for (const subtask of subtasks) {
      if (!grouped[subtask.task_id]) grouped[subtask.task_id] = [];
      grouped[subtask.task_id].push(subtask);
    }
    return grouped;
  }, [subtasks]);
  const agentSubAgents = subAgents.filter((subAgent) => subAgent.parentAgentId === agent.id);
  const statusCfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
  const oauthProviderKey =
    selectedCli === "copilot" ? "github-copilot" : selectedCli === "antigravity" ? "antigravity" : null;
  const activeOAuthAccounts = useMemo(() => {
    if (!oauthProviderKey || !oauthStatus) return [];
    return (oauthStatus.providers[oauthProviderKey]?.accounts ?? []).filter(
      (account) => account.active && account.status === "active",
    );
  }, [oauthProviderKey, oauthStatus]);
  const requiresOAuthAccount = selectedCli === "copilot" || selectedCli === "antigravity";
  const requiresApiProvider = selectedCli === "api";
  const supportsCliModelOverride = CLI_MODEL_OVERRIDE_PROVIDERS.includes(selectedCli);
  const selectedCliModelOptions = useMemo(() => cliModels[selectedCli] ?? [], [cliModels, selectedCli]);
  const selectedCliModelMeta = useMemo(
    () => selectedCliModelOptions.find((model) => model.slug === selectedCliModel),
    [selectedCliModelOptions, selectedCliModel],
  );
  const codexReasoningOptions = useMemo(() => {
    if (selectedCli !== "codex") return [];
    if (selectedCliModelMeta?.reasoningLevels && selectedCliModelMeta.reasoningLevels.length > 0) {
      return selectedCliModelMeta.reasoningLevels;
    }
    return CODEX_REASONING_FALLBACK_OPTIONS;
  }, [selectedCli, selectedCliModelMeta]);
  const selectedApiProvider = apiProviders.find((provider) => provider.id === selectedApiProviderId && provider.enabled);
  const canSaveCli = Boolean(selectedCli) && (requiresApiProvider
    ? Boolean(selectedApiProvider && selectedApiModel.trim() && !apiLoading)
    : !requiresOAuthAccount || Boolean(selectedOAuthAccountId));

  useEffect(() => {
    setInstructionDraft(agent.personality ?? "");
    setConfigError("");
  }, [agent.id, agent.personality]);

  useEffect(() => {
    if (!editingCli || !requiresApiProvider) return;
    let cancelled = false;
    setConfigError("");
    api.getApiProviders().then((providers) => {
      if (!cancelled) setApiProviders(providers.filter((provider) => provider.enabled));
    }).catch(() => {
      if (!cancelled) setConfigError("Não foi possível carregar os provedores de API.");
    });
    return () => { cancelled = true; };
  }, [editingCli, requiresApiProvider]);

  useEffect(() => {
    setApiModels([]);
    setApiLoading(false);
    if (!editingCli || !requiresApiProvider || !selectedApiProviderId) return;
    let cancelled = false;
    setApiLoading(true);
    api.getApiProviderModels(selectedApiProviderId).then((result) => {
      if (!cancelled) {
        setApiModels(result.models ?? []);
        if (!result.ok) setConfigError("Lista de modelos indisponível. Verifique a conexão em Configurações.");
      }
    }).catch(() => {
      if (!cancelled) setConfigError("Lista de modelos indisponível. Verifique a conexão em Configurações.");
    }).finally(() => {
      if (!cancelled) setApiLoading(false);
    });
    return () => { cancelled = true; };
  }, [editingCli, requiresApiProvider, selectedApiProviderId]);

  const handleSaveInstructions = async () => {
    setSavingInstructions(true);
    setConfigError("");
    try {
      await api.updateAgent(agent.id, { personality: instructionDraft.trim() || null });
      onAgentUpdated?.();
    } catch {
      setConfigError("Não foi possível salvar as instruções.");
    } finally {
      setSavingInstructions(false);
    }
  };
  const getReasoningDescription = useCallback(
    (effort: string, fallback?: string) => {
      switch (effort) {
        case "low":
          return t({ ko: "빠름, 낮은 깊이", en: "Faster, lower depth", ja: "高速・浅い推論", zh: "更快，较浅推理" });
        case "medium":
          return t({ ko: "균형 기본값", en: "Balanced default", ja: "バランス既定", zh: "均衡默认" });
        case "high":
          return t({ ko: "높은 추론 깊이", en: "Higher reasoning depth", ja: "高い推論深度", zh: "更高推理深度" });
        case "xhigh":
          return t({
            ko: "최대 추론 깊이",
            en: "Maximum reasoning depth",
            ja: "最大推論深度",
            zh: "最高推理深度",
          });
        default:
          return fallback || "";
      }
    },
    [t],
  );


  useEffect(() => {
    setSelectedCli(agent.cli_provider);
    setSelectedOAuthAccountId(agent.oauth_account_id ?? "");
    setSelectedApiProviderId(agent.api_provider_id ?? "");
    setSelectedApiModel(agent.api_model ?? "");
    setSelectedCliModel(agent.cli_model ?? "");
    setSelectedCliReasoningLevel(agent.cli_reasoning_level ?? "");
    setActsAsPlanningLead(Number(agent.acts_as_planning_leader ?? 0) === 1);
  }, [
    agent.id,
    agent.cli_provider,
    agent.oauth_account_id,
    agent.api_provider_id,
    agent.api_model,
    agent.cli_model,
    agent.cli_reasoning_level,
    agent.acts_as_planning_leader,
  ]);

  useEffect(() => {
    if (!editingCli || !requiresOAuthAccount) return;
    setOauthLoading(true);
    api
      .getOAuthStatus()
      .then(setOauthStatus)
      .catch((err) => console.error("Failed to load OAuth status:", err))
      .finally(() => setOauthLoading(false));
  }, [editingCli, requiresOAuthAccount]);

  useEffect(() => {
    if (!editingCli || !supportsCliModelOverride || Object.keys(cliModels).length > 0) return;
    let cancelled = false;
    setCliModelsLoading(true);
    api
      .getCliModels()
      .then((models) => {
        if (cancelled) return;
        setCliModels(models);
      })
      .catch((err) => console.error("Failed to load CLI models:", err))
      .finally(() => {
        if (!cancelled) setCliModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editingCli, supportsCliModelOverride, cliModels]);

  useEffect(() => {
    if (!requiresOAuthAccount) {
      if (selectedOAuthAccountId) setSelectedOAuthAccountId("");
      return;
    }
    if (activeOAuthAccounts.length === 0) return;
    if (!selectedOAuthAccountId || !activeOAuthAccounts.some((account) => account.id === selectedOAuthAccountId)) {
      setSelectedOAuthAccountId(activeOAuthAccounts[0].id);
    }
  }, [requiresOAuthAccount, activeOAuthAccounts, selectedOAuthAccountId]);

  useEffect(() => {
    if (!supportsCliModelOverride && selectedCliModel) {
      setSelectedCliModel("");
    }
  }, [supportsCliModelOverride, selectedCliModel]);

  useEffect(() => {
    if (selectedCli !== "codex" && selectedCliReasoningLevel) {
      setSelectedCliReasoningLevel("");
      return;
    }
    if (selectedCli === "codex" && selectedCliReasoningLevel) {
      const isValid = codexReasoningOptions.some((level) => level.effort === selectedCliReasoningLevel);
      if (!isValid) setSelectedCliReasoningLevel("");
    }
  }, [selectedCli, selectedCliReasoningLevel, codexReasoningOptions]);

  const handleSaveCli = useCallback(async () => {
    setSavingCli(true);
    setConfigError("");
    try {
      await api.updateAgent(agent.id, {
        cli_provider: selectedCli,
        oauth_account_id: requiresOAuthAccount ? selectedOAuthAccountId || null : null,
        api_provider_id: requiresApiProvider ? selectedApiProviderId || null : null,
        api_model: requiresApiProvider ? selectedApiModel || null : null,
        cli_model: supportsCliModelOverride ? selectedCliModel || null : null,
        cli_reasoning_level: selectedCli === "codex" ? selectedCliReasoningLevel || null : null,
      });
      onAgentUpdated?.();
      setEditingCli(false);
    } catch (error) {
      console.error("Failed to update CLI:", error);
      setConfigError("Não foi possível salvar o provedor e o modelo.");
    } finally {
      setSavingCli(false);
    }
  }, [
    agent.id,
    selectedCli,
    requiresOAuthAccount,
    selectedOAuthAccountId,
    requiresApiProvider,
    selectedApiProviderId,
    selectedApiModel,
    supportsCliModelOverride,
    selectedCliModel,
    selectedCliReasoningLevel,
    onAgentUpdated,
  ]);

  const handleCancelCliEdit = useCallback(() => {
    setEditingCli(false);
    setSelectedCli(agent.cli_provider);
    setSelectedOAuthAccountId(agent.oauth_account_id ?? "");
    setSelectedApiProviderId(agent.api_provider_id ?? "");
    setSelectedApiModel(agent.api_model ?? "");
    setSelectedCliModel(agent.cli_model ?? "");
    setSelectedCliReasoningLevel(agent.cli_reasoning_level ?? "");
  }, [
    agent.cli_provider,
    agent.oauth_account_id,
    agent.api_provider_id,
    agent.api_model,
    agent.cli_model,
    agent.cli_reasoning_level,
  ]);

  const resolvePackLabel = useCallback(
    (packKey: WorkflowPackKey) => {
      switch (packKey) {
        case "development":
          return t({ ko: "개발", en: "Development", ja: "開発", zh: "开发" });
        case "novel":
          return t({ ko: "소설", en: "Novel", ja: "小説", zh: "小说" });
        case "report":
          return t({ ko: "리포트", en: "Report", ja: "レポート", zh: "报告" });
        case "video_preprod":
          return t({ ko: "영상 프리프로덕션", en: "Video Pre-production", ja: "動画プリプロ", zh: "视频前期" });
        case "web_research_report":
          return t({ ko: "웹 리서치 리포트", en: "Web Research Report", ja: "Webリサーチ", zh: "网页调研报告" });
        case "roleplay":
          return t({ ko: "역할놀이", en: "Roleplay", ja: "ロールプレイ", zh: "角色扮演" });
        default:
          return packKey;
      }
    },
    [t],
  );

  const handlePlanningLeadToggle = useCallback(
    async (nextChecked: boolean) => {
      if (agent.role !== "team_leader" || savingPlanningLead) return;
      const previous = actsAsPlanningLead;
      setActsAsPlanningLead(nextChecked);
      setSavingPlanningLead(true);

      try {
        await api.updateAgent(agent.id, {
          acts_as_planning_leader: nextChecked ? 1 : 0,
          workflow_pack_key: activeOfficeWorkflowPack,
        });
        onAgentUpdated?.();
      } catch (error) {
        if (
          nextChecked &&
          api.isApiRequestError(error) &&
          error.status === 409 &&
          error.code === "planning_leader_exists"
        ) {
          const details = (error.details ?? {}) as {
            existing_leader?: { name?: string | null; name_ko?: string | null };
            pack_key?: WorkflowPackKey | null;
          };
          const existingLeaderName = String(
            details.existing_leader?.name_ko ||
              details.existing_leader?.name ||
              t({ ko: "기존 리더", en: "current leader" }),
          ).trim();
          const packKey = details.pack_key ?? activeOfficeWorkflowPack;
          const packLabel = resolvePackLabel(packKey);
          const confirmed = window.confirm(
            t({
              ko: `이미 ${existingLeaderName}가 ${packLabel} 오피스팩의 리더입니다. 변경하시겠습니까?`,
              en: `${existingLeaderName} is already the leader for the ${packLabel} office pack. Change leader?`,
              ja: `${existingLeaderName}さんが既に${packLabel}オフィスパックのリーダーです。変更しますか？`,
              zh: `${existingLeaderName} 已是 ${packLabel} 办公包负责人。要变更吗？`,
            }),
          );
          if (confirmed) {
            try {
              await api.updateAgent(agent.id, {
                acts_as_planning_leader: 1,
                workflow_pack_key: activeOfficeWorkflowPack,
                force_planning_leader_override: true,
              });
              onAgentUpdated?.();
              return;
            } catch (overrideError) {
              console.error("Failed to override planning lead:", overrideError);
            }
          }
        } else {
          console.error("Failed to update planning lead:", error);
        }
        setActsAsPlanningLead(previous);
      } finally {
        setSavingPlanningLead(false);
      }
    },
    [
      activeOfficeWorkflowPack,
      agent.id,
      agent.role,
      actsAsPlanningLead,
      onAgentUpdated,
      resolvePackLabel,
      savingPlanningLead,
      t,
    ],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[calc(100vw-1.5rem)] max-w-[560px] max-h-[92dvh] flex flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl">
        <div
          className="relative px-6 py-5 border-b border-slate-700"
          style={{
            background: department ? `linear-gradient(135deg, ${department.color}22, transparent)` : undefined,
          }}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-700/50 hover:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>

          <div className="flex items-center gap-4">
            <div className="relative">
              <AgentAvatar
                agent={agent}
                agents={agents}
                size={64}
                rounded="2xl"
                className={agent.status === "working" ? "animate-agent-work" : ""}
              />
              <div
                className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-800 ${
                  agent.status === "working"
                    ? "bg-blue-500"
                    : agent.status === "idle"
                      ? "bg-green-500"
                      : agent.status === "break"
                        ? "bg-yellow-500"
                        : "bg-slate-500"
                }`}
              />
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{localeName(language, agent)}</h2>
                <span className={`text-xs px-1.5 py-0.5 rounded ${statusCfg.bg} ${statusCfg.color}`}>
                  {statusLabel(statusCfg.label, t)}
                </span>
              </div>
              <div className="text-sm text-slate-400 mt-0.5">
                {department?.icon} {department ? localeName(language, department) : ""} · {roleLabel(agent.role, t)}
              </div>
              {agent.role === "team_leader" && (
                <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={actsAsPlanningLead}
                    disabled={savingPlanningLead}
                    onChange={(event) => {
                      void handlePlanningLeadToggle(event.target.checked);
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500/50 disabled:opacity-60"
                  />
                  <span>
                    {t({
                      ko: "Lead (기획 리더)",
                      en: "Lead (Planning lead)",
                      ja: "Lead（企画リード）",
                      zh: "Lead（企划负责人）",
                    })}
                  </span>
                  {savingPlanningLead && (
                    <span className="text-[10px] text-slate-400">
                      {t({ ko: "저장중...", en: "Saving...", ja: "保存中...", zh: "保存中..." })}
                    </span>
                  )}
                </label>
              )}
              <div className="text-xs text-slate-500 mt-0.5">
                {editingCli ? (
                  selectedCli === "codex" ? (
                    <div className="space-y-1">
                      <div className="flex w-full min-w-0 items-center gap-1 pb-0.5">
                        <span className="shrink-0">🔧</span>
                        <select
                          value={selectedCli ?? ""}
                          onChange={(event) => {
                            setSelectedCli(event.target.value as Agent["cli_provider"]);
                            setSelectedCliModel("");
                            setSelectedCliReasoningLevel("");
                          }}
                          className="w-[94px] shrink-0 bg-slate-700 text-slate-200 text-xs rounded px-1 py-0.5 border border-slate-600 focus:outline-none focus:border-blue-500"
                        >
                          <option value="" disabled>Sem provedor configurado</option>
                          {Object.entries(CLI_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {cliModelsLoading ? (
                          <span className="text-[10px] text-slate-400">
                            {t({
                              ko: "모델 로딩...",
                              en: "Loading models...",
                              ja: "モデル読み込み中...",
                              zh: "正在加载模型...",
                            })}
                          </span>
                        ) : selectedCliModelOptions.length > 0 ? (
                          <>
                            <select
                              value={selectedCliModel}
                              onChange={(event) => {
                                const nextModel = event.target.value;
                                setSelectedCliModel(nextModel);
                                const nextMeta = selectedCliModelOptions.find((model) => model.slug === nextModel);
                                setSelectedCliReasoningLevel(nextMeta?.defaultReasoningLevel || "");
                              }}
                              className="w-0 min-w-0 flex-1 bg-slate-700 text-slate-200 text-xs rounded px-1 py-0.5 border border-slate-600 focus:outline-none focus:border-blue-500"
                            >
                              <option value="">
                                {t({
                                  ko: "기본값(설정창 모델)",
                                  en: "Default (Settings model)",
                                  ja: "デフォルト（設定モデル）",
                                  zh: "默认（设置中的模型）",
                                })}
                              </option>
                              {selectedCliModelOptions.map((model) => (
                                <option key={model.slug} value={model.slug}>
                                  {model.displayName || model.slug}
                                </option>
                              ))}
                            </select>
                            {codexReasoningOptions.length > 0 && (
                              <select
                                value={selectedCliReasoningLevel}
                                onChange={(event) => setSelectedCliReasoningLevel(event.target.value)}
                                className="w-0 min-w-0 flex-1 bg-slate-700 text-slate-200 text-xs rounded px-1 py-0.5 border border-slate-600 focus:outline-none focus:border-blue-500"
                              >
                                <option value="">
                                  {t({
                                    ko: "기본값(설정창 추론)",
                                    en: "Default (Settings reasoning)",
                                    ja: "デフォルト（設定推論）",
                                    zh: "默认（设置中的推理）",
                                  })}
                                </option>
                                {codexReasoningOptions.map((level) => (
                                  <option key={level.effort} value={level.effort}>
                                    {level.effort}
                                    {getReasoningDescription(level.effort, level.description)
                                      ? ` (${getReasoningDescription(level.effort, level.description)})`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            {t({
                              ko: "모델 목록이 없습니다",
                              en: "No model list available",
                              ja: "モデル一覧がありません",
                              zh: "暂无模型列表",
                            })}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-slate-400">
                          {t({
                            ko: "알바생 모델은 설정창 값을 따릅니다",
                            en: "Sub-agent model follows Settings",
                            ja: "サブエージェントモデルは設定値を使用",
                            zh: "子代理模型沿用设置值",
                          })}
                        </span>
                        <button
                          disabled={savingCli || !canSaveCli}
                          onClick={() => {
                            void handleSaveCli();
                          }}
                          className="text-[10px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                        >
                          {savingCli ? "..." : t({ ko: "저장", en: "Save", ja: "保存", zh: "保存" })}
                        </button>
                        <button
                          onClick={handleCancelCliEdit}
                          className="text-[10px] px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 text-slate-300 rounded transition-colors"
                        >
                          {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      <span>🔧</span>
                      <select
                        value={selectedCli ?? ""}
                        onChange={(event) => {
                          setSelectedCli(event.target.value as Agent["cli_provider"]);
                          setSelectedCliModel("");
                          setSelectedCliReasoningLevel("");
                        }}
                        className="bg-slate-700 text-slate-200 text-xs rounded px-1.5 py-0.5 border border-slate-600 focus:outline-none focus:border-blue-500"
                      >
                        <option value="" disabled>Sem provedor configurado</option>
                          {Object.entries(CLI_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {requiresOAuthAccount &&
                        (oauthLoading ? (
                          <span className="text-[10px] text-slate-400">
                            {t({
                              ko: "계정 로딩...",
                              en: "Loading accounts...",
                              ja: "アカウント読み込み中...",
                              zh: "正在加载账号...",
                            })}
                          </span>
                        ) : activeOAuthAccounts.length > 0 ? (
                          <select
                            value={selectedOAuthAccountId}
                            onChange={(event) => setSelectedOAuthAccountId(event.target.value)}
                            className="bg-slate-700 text-slate-200 text-xs rounded px-1.5 py-0.5 border border-slate-600 focus:outline-none focus:border-blue-500 max-w-[170px]"
                          >
                            {activeOAuthAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {oauthAccountLabel(account)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[10px] text-amber-300">
                            {t({
                              ko: "활성 OAuth 계정 없음",
                              en: "No active OAuth account",
                              ja: "有効な OAuth アカウントなし",
                              zh: "没有可用的 OAuth 账号",
                            })}
                          </span>
                        ))}
                      {requiresApiProvider && (
                        <div className="w-full space-y-1.5">
                          <label className="block">Provedor de API</label>
                          <select
                            aria-label="Provedor de API"
                            value={selectedApiProviderId}
                            onChange={(event) => {
                              setSelectedApiProviderId(event.target.value);
                              setSelectedApiModel("");
                              setConfigError("");
                            }}
                            className="w-full bg-slate-700 text-slate-200 rounded px-2 py-1 border border-slate-600"
                          >
                            <option value="">Selecione um provedor</option>
                            {apiProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.name} ({provider.type})</option>
                            ))}
                          </select>
                          {apiProviders.length === 0 && (
                            <p className="text-amber-300">Cadastre o OpenRouter em Configurações &gt; API.</p>
                          )}
                          {selectedApiProviderId && (
                            <>
                              <label className="block">Modelo</label>
                              <input
                                aria-label="Modelo de API"
                                list="agent-api-models"
                                value={selectedApiModel}
                                onChange={(event) => setSelectedApiModel(event.target.value)}
                                placeholder={apiLoading ? "Carregando modelos..." : "Identificador do modelo"}
                                className="w-full bg-slate-700 text-slate-200 rounded px-2 py-1 border border-slate-600"
                              />
                              <datalist id="agent-api-models">
                                {apiModels.map((model) => <option key={model} value={model} />)}
                              </datalist>
                            </>
                          )}
                        </div>
                      )}
                      {supportsCliModelOverride &&
                        (cliModelsLoading ? (
                          <span className="text-[10px] text-slate-400">
                            {t({
                              ko: "모델 로딩...",
                              en: "Loading models...",
                              ja: "モデル読み込み中...",
                              zh: "正在加载模型...",
                            })}
                          </span>
                        ) : selectedCliModelOptions.length > 0 ? (
                          <>
                            <select
                              value={selectedCliModel}
                              onChange={(event) => {
                                const nextModel = event.target.value;
                                setSelectedCliModel(nextModel);
                              }}
                              className="bg-slate-700 text-slate-200 text-xs rounded px-1.5 py-0.5 border border-slate-600 focus:outline-none focus:border-blue-500 max-w-[210px]"
                            >
                              <option value="">
                                {t({
                                  ko: "기본값(설정창 모델)",
                                  en: "Default (Settings model)",
                                  ja: "デフォルト（設定モデル）",
                                  zh: "默认（设置中的模型）",
                                })}
                              </option>
                              {selectedCliModelOptions.map((model) => (
                                <option key={model.slug} value={model.slug}>
                                  {model.displayName || model.slug}
                                </option>
                              ))}
                            </select>
                            <span className="text-[10px] text-slate-400">
                              {t({
                                ko: "알바생 모델은 설정창 값을 따릅니다",
                                en: "Sub-agent model follows Settings",
                                ja: "サブエージェントモデルは設定値を使用",
                                zh: "子代理模型沿用设置值",
                              })}
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            {t({
                              ko: "모델 목록이 없습니다",
                              en: "No model list available",
                              ja: "モデル一覧がありません",
                              zh: "暂无模型列表",
                            })}
                          </span>
                        ))}
                      <button
                        disabled={savingCli || !canSaveCli}
                        onClick={() => {
                          void handleSaveCli();
                        }}
                        className="text-[10px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                      >
                        {savingCli ? "..." : t({ ko: "저장", en: "Save", ja: "保存", zh: "保存" })}
                      </button>
                      <button
                        onClick={handleCancelCliEdit}
                        className="text-[10px] px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 text-slate-300 rounded transition-colors"
                      >
                        {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    onClick={() => setEditingCli(true)}
                    className="flex items-center gap-1 hover:text-slate-300 transition-colors"
                    title={t({
                      ko: "클릭하여 CLI 변경",
                      en: "Click to change CLI",
                      ja: "クリックして CLI を変更",
                      zh: "点击更改 CLI",
                    })}
                  >
                    {"Modelo: "}
                    {!agent.cli_provider ? "Não configurado" : agent.cli_provider === "api" && agent.api_model
                      ? `API: ${agent.api_model}`
                      : agent.cli_model &&
                          CLI_MODEL_OVERRIDE_PROVIDERS.includes(agent.cli_provider) &&
                          agent.cli_provider !== "api"
                        ? `${CLI_LABELS[agent.cli_provider] ?? agent.cli_provider} · ${agent.cli_model}${agent.cli_provider === "codex" && agent.cli_reasoning_level ? ` (${agent.cli_reasoning_level})` : ""}`
                        : agent.cli_provider === "codex" && agent.cli_reasoning_level
                          ? `${CLI_LABELS[agent.cli_provider] ?? agent.cli_provider} · (${agent.cli_reasoning_level})`
                          : (CLI_LABELS[agent.cli_provider] ?? agent.cli_provider)}
                    <span className="text-[9px] text-slate-600 ml-0.5">✏️</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-700 pt-3 text-xs text-slate-400">
            <span>{agentTasks.filter((task) => task.status === "in_progress").length} em execução</span>
            <span>{agentTasks.filter((task) => task.status === "pending").length} pendentes</span>
            <span>{agent.stats_tasks_done} concluídas</span>
          </div>
        </div>

        <div className="flex border-b border-slate-700">
          {[
            { key: "info", label: t({ ko: "정보", en: "Info", ja: "情報", zh: "信息" }) },
            {
              key: "tasks",
              label: `${t({ ko: "업무", en: "Tasks", ja: "タスク", zh: "任务" })} (${agentTasks.length})`,
            },
            {
              key: "alba",
              label: `${t({ ko: "알바생", en: "Sub-agents", ja: "サブエージェント", zh: "子代理" })} (${agentSubAgents.length})`,
            },
          ].map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key as typeof tab)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tab === tabItem.key ? "text-blue-400 border-b-2 border-blue-400" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto min-h-0 flex-1">
          {configError && <p role="alert" className="mb-3 text-xs text-red-300">{configError}</p>}
          {tab === "info" && (
            <section className="mb-4 space-y-2 rounded-lg border border-slate-600 p-3">
              <label htmlFor="agent-instructions" className="block text-xs font-semibold text-slate-200">Instruções individuais</label>
              <textarea id="agent-instructions" rows={4} value={instructionDraft}
                onChange={(event) => setInstructionDraft(event.target.value)}
                placeholder="Defina as instruções quando estiver pronto."
                className="w-full rounded bg-slate-700 p-2 text-sm text-slate-100" />
              <button type="button" disabled={savingInstructions || instructionDraft === (agent.personality ?? "")}
                onClick={() => void handleSaveInstructions()}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">
                {savingInstructions ? "Salvando..." : "Salvar instruções"}
              </button>
            </section>
          )}
          {tab === "info" && <AgentSchedule key={agent.id} agent={agent} tasks={agentTasks} />}
          {tab === "info" && <AgentToolRegistry key={agent.id + "-tools"} agentId={agent.id} />}
          {tab === "info" && <AgentUsage key={agent.id + "-usage"} agentId={agent.id} />}
          <AgentDetailTabContent
            tab={tab}
            t={t}
            language={language}
            agent={agent}
            departments={departments}
            agentTasks={agentTasks}
            agentSubAgents={agentSubAgents}
            subtasksByTask={subtasksByTask}
            expandedTaskId={expandedTaskId}
            setExpandedTaskId={setExpandedTaskId}
            onChat={onChat}
            onAssignTask={onAssignTask}
            onOpenTerminal={onOpenTerminal}
          />
        </div>
      </div>
    </div>
  );
}
