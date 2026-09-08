import type { AnnualCostProjection, CostBasis, ExpenseSource } from '../accounting/costs.js'

type Contribution = AnnualCostProjection['contributions'][number]
export type CostTraceSelection = { kind: 'basis' | 'contribution'; id: string }
export type CostTraceNode =
  | { kind: 'source'; key: string; record: ExpenseSource; inputs: string[] }
  | { kind: 'basis'; key: string; record: CostBasis; inputs: string[] }
  | { kind: 'contribution'; key: string; record: Contribution; inputs: string[] }
export type CostTrace = { nodes: CostTraceNode[]; issues: string[] }

/** Follow only this projection's stored references; never recompute or fill missing material. */
export function traceCost(
  projection: AnnualCostProjection,
  selection: CostTraceSelection,
): CostTrace {
  const records = new Map<string, CostTraceNode>()
  const issues: string[] = []
  function register(node: CostTraceNode) {
    if (records.has(node.key)) issues.push(`参照IDが重複しています：${node.key}`)
    else records.set(node.key, node)
  }
  for (const record of projection.sources)
    register({ kind: 'source', key: `source:${record.id}`, record, inputs: [] })
  for (const record of projection.bases)
    register({
      kind: 'basis',
      key: `basis:${record.id}`,
      record,
      inputs: [
        ...(record.sourceId ? [`source:${record.sourceId}`] : []),
        ...record.parentContributionIds.map((id) => `contribution:${id}`),
      ],
    })
  for (const record of projection.contributions)
    register({
      kind: 'contribution',
      key: `contribution:${record.id}`,
      record,
      inputs: [`basis:${record.basisId}`],
    })
  const states = new Map<string, 'visiting' | 'done'>()
  const nodes: CostTraceNode[] = []
  const stack = [{ key: `${selection.kind}:${selection.id}`, exit: false }]
  while (stack.length) {
    const item = stack.pop()!
    if (item.exit) {
      states.set(item.key, 'done')
      nodes.push(records.get(item.key)!)
      continue
    }
    if (states.get(item.key) === 'done') continue
    if (states.get(item.key) === 'visiting') {
      issues.push(`参照が循環しています：${item.key}`)
      continue
    }
    const node = records.get(item.key)
    if (!node) {
      issues.push(`この資料に参照先が含まれていません：${item.key}`)
      continue
    }
    states.set(item.key, 'visiting')
    stack.push({ key: item.key, exit: true })
    for (const key of [...node.inputs].reverse()) stack.push({ key, exit: false })
  }
  return { nodes, issues: [...new Set(issues)] }
}
