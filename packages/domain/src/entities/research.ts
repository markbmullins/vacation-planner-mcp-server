import type { ISODateTime, ResearchArtifactType } from "@dive-planner/shared";

export interface ResearchArtifact {
  id: string;
  artifactType: ResearchArtifactType;
  destinationId?: string;
  operatorId?: string;
  topic: string;
  summary: string;
  positiveThemes: string[];
  negativeThemes: string[];
  confidenceNote?: string;
  /** pgvector embedding stored separately in persistence layer */
  embedding?: number[];
  sourceRecordId: string;
  createdAt: ISODateTime;
}
