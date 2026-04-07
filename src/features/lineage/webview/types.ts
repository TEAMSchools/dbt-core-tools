export type ViewMode = "nn" | "upstream" | "downstream";

export interface GraphNodeData {
  [key: string]: unknown;
  id: string;
  name: string;
  resourceType: string;
  materialization: string;
  contractEnforced: boolean;
  testCount: number;
  isCurrent: boolean;
}
