import type { Proposal, SourceRef } from "../../schema/lock.js";

export interface SourceDoc {
  title: string;
  body: string;
  tasks: { checked: boolean; text: string }[];
  comments: { body: string; url?: string; author?: string }[];
}

export interface AdapterChoice {
  decisionId: string;
  optionIds: string[];
}

export interface SourceAdapter {
  name: string;
  read(ref: string): Promise<SourceDoc>;
  readSelections(ref: string, proposal: Proposal): Promise<AdapterChoice[]>;
  publish?(ref: string, proposal: Proposal): Promise<{ url?: string }>;
  postComment?(ref: string, body: string): Promise<{ url?: string }>;
}

export type { SourceRef };
