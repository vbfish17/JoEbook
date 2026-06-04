export interface RoleApiConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export type AgentRole = 'planner' | 'executor' | 'proofreader';

export interface RoleApiMap {
  planner: RoleApiConfig;
  executor: RoleApiConfig;
  proofreader: RoleApiConfig;
}

export interface AgentAllocationInput {
  totalItems: number;
  batchSize?: number;
  maxExecutors?: number;
  enableProofreader?: boolean;
  roleApi?: Partial<RoleApiMap>;
}

export interface AgentBatchPlan {
  id: string;
  role: AgentRole;
  workerIndex: number;
  startIndex: number;
  endIndex: number;
  itemCount: number;
}

export interface AgentAllocationPlan {
  totalItems: number;
  batchSize: number;
  executorBatches: AgentBatchPlan[];
  roles: Record<AgentRole, { count: number; api: RoleApiConfig }>;
  summary: string;
}

const DEFAULT_API: RoleApiConfig = { apiKey: '', baseUrl: '', model: '' };

export function normalizeRoleApiConfig(config?: RoleApiConfig): RoleApiConfig {
  return {
    apiKey: config?.apiKey || '',
    baseUrl: config?.baseUrl || '',
    model: config?.model || '',
  };
}

export function buildRoleApiMap(defaultApi?: RoleApiConfig, roleApi?: Partial<RoleApiMap>): RoleApiMap {
  const base = normalizeRoleApiConfig(defaultApi || DEFAULT_API);
  return {
    planner: normalizeRoleApiConfig({ ...base, ...(roleApi?.planner || {}) }),
    executor: normalizeRoleApiConfig({ ...base, ...(roleApi?.executor || {}) }),
    proofreader: normalizeRoleApiConfig({ ...base, ...(roleApi?.proofreader || {}) }),
  };
}

export function planAgentAllocation(input: AgentAllocationInput): AgentAllocationPlan {
  const totalItems = Math.max(0, Math.floor(Number(input.totalItems) || 0));
  const batchSize = Math.max(1, Math.floor(Number(input.batchSize) || 20));
  const maxExecutors = Math.max(1, Math.floor(Number(input.maxExecutors) || 6));
  const executorCount = totalItems === 0 ? 0 : Math.min(maxExecutors, Math.max(1, Math.ceil(totalItems / batchSize)));
  const roleApi = buildRoleApiMap(undefined, input.roleApi);

  const executorBatches: AgentBatchPlan[] = [];
  if (totalItems > 0 && executorCount > 0) {
    const chunkSize = Math.ceil(totalItems / executorCount);
    for (let i = 0; i < executorCount; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(totalItems, startIndex + chunkSize);
      if (startIndex >= endIndex) continue;
      executorBatches.push({
        id: `executor-${i + 1}`,
        role: 'executor',
        workerIndex: i + 1,
        startIndex,
        endIndex,
        itemCount: endIndex - startIndex,
      });
    }
  }

  return {
    totalItems,
    batchSize,
    executorBatches,
    roles: {
      planner: { count: totalItems > 0 ? 1 : 0, api: roleApi.planner },
      executor: { count: executorBatches.length, api: roleApi.executor },
      proofreader: { count: input.enableProofreader && totalItems > 0 ? 1 : 0, api: roleApi.proofreader },
    },
    summary: totalItems > 0
      ? `规划智能体 1 个，执行智能体 ${executorBatches.length} 个${input.enableProofreader ? '，校对智能体 1 个' : ''}。`
      : '未检测到待翻译文本，暂不分配智能体。',
  };
}
