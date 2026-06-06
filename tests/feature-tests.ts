import assert from 'node:assert/strict';
import {
  extractTermCandidates,
  parseTermComparisonText,
  applyTerminologyToText,
} from '../src/termbase.ts';
import {
  planAgentAllocation,
  buildRoleApiMap,
} from '../src/agentOrchestrator.ts';

async function main() {
  const parsed = parseTermComparisonText(`
Agent Suitability Framework => 智能体适用性评估框架
Model Context Protocol,模型上下文协议
Human-in-the-loop\t人在回路中
  `, { sourceLang: 'English', targetLang: 'Chinese (Simplified)', domain: 'ai' });
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map(t => t.source), ['Agent Suitability Framework', 'Model Context Protocol', 'Human-in-the-loop']);
  assert.equal(parsed[0].target, '智能体适用性评估框架');
  assert.equal(parsed[0].sourceLang, 'English');
  assert.equal(parsed[0].domain, 'ai');

  const autoLangParsed = parseTermComparisonText('Model Context Protocol => 模型上下文协议', { sourceLang: 'Auto', targetLang: 'Auto', domain: 'ai' });
  assert.equal(autoLangParsed[0].sourceLang, 'en');
  assert.equal(autoLangParsed[0].targetLang, 'zh-CN');

  const candidates = extractTermCandidates('The Model Context Protocol is important.', '模型上下文协议很重要。', 'MCP 协议很重要。');
  assert.ok(candidates.length >= 1, 'manual proofreading diff should produce a learning candidate');
  assert.equal(candidates[0].target, 'MCP 协议');

  const applied = applyTerminologyToText('Model Context Protocol enables Agent Design Card workflows.', [
    { source: 'Model Context Protocol', target: '模型上下文协议' },
    { source: 'Agent Design Card', target: '智能体设计卡' },
  ]);
  assert.equal(applied, '模型上下文协议 enables 智能体设计卡 workflows.');

  const plan = planAgentAllocation({
    totalItems: 96,
    batchSize: 20,
    maxExecutors: 6,
    enableProofreader: true,
    roleApi: {
      planner: { baseUrl: 'https://planner.example/v1', model: 'planner-model' },
      executor: { baseUrl: 'https://executor.example/v1', model: 'executor-model' },
      proofreader: { baseUrl: 'https://proof.example/v1', model: 'proof-model' },
    },
  });
  assert.equal(plan.roles.planner.count, 1);
  assert.equal(plan.roles.executor.count, 5);
  assert.equal(plan.roles.proofreader.count, 1);
  assert.equal(plan.executorBatches.length, 5);
  assert.equal(plan.executorBatches.reduce((sum, b) => sum + b.itemCount, 0), 96);
  assert.equal(plan.roles.executor.api.model, 'executor-model');

  const roleMap = buildRoleApiMap(
    { baseUrl: 'https://default.example/v1', apiKey: 'k', model: 'default-model' },
    { planner: { model: 'planner-model' } }
  );
  assert.equal(roleMap.planner.model, 'planner-model');
  assert.equal(roleMap.planner.baseUrl, 'https://default.example/v1');
  assert.equal(roleMap.executor.model, 'default-model');

  console.log('feature-tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
