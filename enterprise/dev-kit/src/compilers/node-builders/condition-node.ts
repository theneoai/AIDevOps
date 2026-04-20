import { ConditionStepConfig } from '../../types/dsl';

export interface DifyConditionNode {
  id: string;
  type: 'if-else';
  data: {
    title: string;
    conditions: Array<{
      id: string;
      variable: string;
      comparison_operator: string;
      value: string;
    }>;
    logical_operator: 'and' | 'or';
  };
  position: { x: number; y: number };
}

export function buildConditionNode(
  id: string,
  name: string,
  config: ConditionStepConfig,
  position: { x: number; y: number },
): DifyConditionNode {
  const conditions = config.branches.map((branch, i) => {
    // Parse simple expressions like "{{steps.x.output}} == 'value'"
    const expr = branch.condition;
    const match = expr.match(/^(.+?)\s*(==|!=|>|<|>=|<=|contains)\s*(.+)$/);

    if (match) {
      return {
        id: `cond-${i}`,
        variable: match[1].trim(),
        comparison_operator: operatorMap(match[2]),
        value: match[3].trim().replace(/^['"]|['"]$/g, ''),
      };
    }

    return {
      id: `cond-${i}`,
      variable: expr.trim(),
      comparison_operator: 'is not empty',
      value: '',
    };
  });

  return {
    id,
    type: 'if-else',
    data: {
      title: name,
      conditions,
      logical_operator: 'or',
    },
    position,
  };
}

function operatorMap(op: string): string {
  const map: Record<string, string> = {
    '==': 'is',
    '!=': 'is not',
    '>': 'greater than',
    '<': 'less than',
    '>=': 'greater than or equal',
    '<=': 'less than or equal',
    contains: 'contains',
  };
  return map[op] ?? op;
}
