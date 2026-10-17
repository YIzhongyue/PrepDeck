import { findNodeAtLocation, parseTree, type Node } from "jsonc-parser";
import { inspectComponentQuestionDraft, type ComponentQuestionDraft } from "./componentQuestionDraft";

export function inspectAnswerControls(raw: string, checked?: ComponentQuestionDraft) {
  // Match the existing package import/export budget; larger drafts remain JSON.
  if (raw.length > 5 * 1024 * 1024 || new TextEncoder().encode(raw).byteLength > 5 * 1024 * 1024) {
    return { reason: "Answer controls support packages up to the 5 MiB import limit. Keep this source in JSON." };
  }
  const draft = checked ?? inspectComponentQuestionDraft(raw);
  if (!draft.preview) return { reason: "Answer controls require one valid schema 2.0 question. Correct the package errors in JSON." };
  try {
    // This gate protects answer token edits only. Duplicate-key raw saves are
    // deliberately owned by the independent #167 validation change.
    const tree = parseTree(raw);
    if (!tree) throw new Error("Missing source");
    const pending = [tree];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.type === "object") {
        const names = node.children?.map(property => property.children![0]!.value) ?? [];
        if (new Set(names).size !== names.length) return { reason: "Answer controls are unavailable for duplicate keys. Resolve the ambiguous object properties in JSON." };
      }
      for (const child of node.children ?? []) pending.push(child);
    }
    const interaction = draft.preview.content?.interaction;
    if (!interaction || (interaction.type !== "order" && interaction.type !== "match")) {
      return { reason: "Answer controls support sorting and matching only. Edit this question in JSON." };
    }
    return { preview: draft.preview, interaction, tree };
  } catch {
    return { reason: "Answer controls could not inspect this source. Keep editing in JSON." };
  }
}

function editable(raw: string) {
  const state = inspectAnswerControls(raw);
  if (!state.preview) throw new Error(state.reason);
  return state;
}

function answerNode(tree: Node, index: number) {
  const node = findNodeAtLocation(tree, ["questions", 0, "scoring", "correctAnswers", index]);
  if (!node || node.type !== "string") throw new Error("Answer token is unavailable. Keep editing in JSON.");
  return node;
}

export function moveAnswer(raw: string, id: string, delta: number): string {
  const state = editable(raw);
  if (state.interaction.type !== "order" || (delta !== -1 && delta !== 1)) throw new Error("Expected a sorting move of one position.");
  const answers = state.preview.correctAnswers;
  const from = answers.indexOf(id), to = from + delta;
  if (from < 0) throw new Error("Unknown answer ID.");
  if (to < 0 || to >= answers.length) return raw;
  const nodes = [answerNode(state.tree, from), answerNode(state.tree, to)];
  const tokens = nodes.map(node => raw.slice(node.offset, node.offset + node.length));
  return nodes.map((node, index) => ({ node, token: tokens[1 - index]! }))
    .sort((a, b) => b.node.offset - a.node.offset)
    .reduce((text, { node, token }) => text.slice(0, node.offset) + token + text.slice(node.offset + node.length), raw);
}

export function setMatch(raw: string, leftId: string, rightId: string): string {
  const state = editable(raw), interaction = state.interaction;
  if (interaction.type !== "match" || !interaction.left.some(option => option.id === leftId) || !interaction.right.some(option => option.id === rightId)) throw new Error("Unknown matching side or ID.");
  const index = state.preview.correctAnswers.findIndex(answer => JSON.parse(answer)[0] === leftId);
  const value = JSON.stringify([leftId, rightId]);
  if (state.preview.correctAnswers[index] === value) return raw;
  const node = answerNode(state.tree, index);
  return raw.slice(0, node.offset) + JSON.stringify(value) + raw.slice(node.offset + node.length);
}
