export interface GraphNodeData {
  [key: string]: unknown;
  id: string;
  name: string;
  resourceType: string;
  materialization: string;
  contractEnforced: boolean;
  testCount: number;
  hasUpstream: boolean;
  hasDownstream: boolean;
  isCurrent: boolean;
  expandedUpstream: boolean;
  expandedDownstream: boolean;
}
