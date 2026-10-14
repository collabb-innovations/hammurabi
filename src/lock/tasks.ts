import type { Proposal } from "../schema/lock.js";

const ATX = /^(#{1,6})\s+(.*?)\s*$/;
const BOLD = /^\*\*(.+)\*\*\s*$/;
const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

export interface TaskItem {
  checked: boolean;
  text: string;
}

export interface DecisionSection {
  checked: string[];
  unknownChecked: string[];
}

export function listTasks(markdown: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const box = CHECKBOX.exec(line);
    if (!box) continue;
    tasks.push({ checked: box[1] !== " ", text: box[2].trim() });
  }
  return tasks;
}

/** Checkboxes under each decision heading. A repeated heading replaces the earlier section. */
export function sectionsFromMarkdown(
  markdown: string,
  proposal: Proposal,
): Map<string, DecisionSection> {
  const sections = new Map<string, DecisionSection>();
  let current: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = headingText(line);
    if (heading !== undefined) {
      current = matchDecision(heading, proposal);
      if (current) {
        sections.set(current, { checked: [], unknownChecked: [] });
      }
      continue;
    }
    if (!current) continue;
    const box = CHECKBOX.exec(line);
    if (!box || box[1] === " ") continue;
    const section = sections.get(current);
    if (!section) continue;
    const text = box[2].trim();
    const optionId = matchOption(text, proposal, current);
    if (!optionId) {
      section.unknownChecked.push(text);
      continue;
    }
    if (!section.checked.includes(optionId)) section.checked.push(optionId);
  }
  return sections;
}

export function choicesFromSections(
  sections: Map<string, DecisionSection>,
): { decisionId: string; optionIds: string[] }[] {
  const choices: { decisionId: string; optionIds: string[] }[] = [];
  for (const [decisionId, section] of sections) {
    choices.push({ decisionId, optionIds: section.checked });
  }
  return choices;
}

export function mergeSections(
  parts: string[],
  proposal: Proposal,
): Map<string, DecisionSection> {
  const merged = new Map<string, DecisionSection>();
  for (const part of parts) {
    for (const [id, section] of sectionsFromMarkdown(part, proposal)) {
      merged.set(id, section);
    }
  }
  return merged;
}

export function renderProposal(proposal: Proposal): string {
  const blocks = proposal.decisions.map((decision) => {
    const lines = [`## ${decision.id} ${decision.question}`, ""];
    for (const option of decision.options) {
      lines.push(`- [ ] ${option.id}: ${option.label}`);
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n") + "\n";
}

export function titleFromMarkdown(markdown: string, fallback: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const h = /^#\s+(.+?)\s*$/.exec(line);
    if (h) return h[1];
  }
  return fallback;
}

export function lockEvidence(parts: { body: string; url?: string; author?: string }[]): {
  url?: string;
  author?: string;
} {
  let found: { url?: string; author?: string } | undefined;
  for (const part of parts) {
    if (/^\s*LOCK\b/m.test(part.body)) {
      found = { url: part.url, author: part.author };
    }
  }
  return found ?? {};
}

function headingText(line: string): string | undefined {
  const atx = ATX.exec(line);
  if (atx) return atx[2].trim();
  const bold = BOLD.exec(line);
  if (bold) return bold[1].trim();
  return undefined;
}

function matchDecision(text: string, proposal: Proposal): string | undefined {
  const ids = proposal.decisions
    .map((d) => d.id)
    .sort((a, b) => b.length - a.length);
  return ids.find(
    (id) =>
      text === id ||
      text.startsWith(`${id} `) ||
      text.startsWith(`${id}:`) ||
      text.startsWith(`${id}\t`),
  );
}

function matchOption(
  text: string,
  proposal: Proposal,
  decisionId: string,
): string | undefined {
  const decision = proposal.decisions.find((d) => d.id === decisionId);
  if (!decision) return undefined;
  const options = [...decision.options].sort((a, b) => b.id.length - a.id.length);
  for (const option of options) {
    const id = option.id;
    if (
      text === id ||
      text.startsWith(`${id}:`) ||
      text.startsWith(`${id} `) ||
      text.startsWith(`${id}.`) ||
      text === option.label
    ) {
      return id;
    }
  }
  return undefined;
}
