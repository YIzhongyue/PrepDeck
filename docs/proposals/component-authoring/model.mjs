// Discovery evidence only. This module is never imported by the application.
import { findNodeAtLocation, parseTree } from "jsonc-parser";
import { normalizeImportFile, validateComponentPackage } from "../../../packages/shared/src/question-components.ts";

function hasDuplicateKeys(node) {
  if (node.type === "object") {
    const keys = node.children.map(property => property.children[0].value);
    if (new Set(keys).size !== keys.length) return true;
  }
  return (node.children ?? []).some(hasDuplicateKeys);
}

export function inspect(raw) {
  let data;
  try { data = JSON.parse(raw); }
  catch { return { raw, reason: "JSON syntax must be corrected in JSON before using answer controls." }; }
  try { return inspectParsed(raw, data); }
  catch { return { raw, reason: "Inspection could not complete. Keep the original source in JSON." }; }
}

function inspectParsed(raw, data) {
  const errors = [];
  const tree = parseTree(raw, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) return { raw, reason: "JSON syntax must be corrected in JSON before using answer controls." };
  // A parsed object alone would hide duplicate keys. Never choose a winner.
  if (hasDuplicateKeys(tree)) return { raw, reason: "Duplicate object keys: keep editing JSON. No key has been removed." };
  const issues = validateComponentPackage(data);
  if (issues.length) return { raw, reason: "This package needs JSON validation fixes.", issues };
  if (data.questions.length !== 1) return { raw, reason: "Answer controls support exactly one question; keep this package in JSON." };
  const item = data.questions[0];
  if (!["order", "match"].includes(item.interaction.type)) return { raw, reason: "This interaction remains in JSON; only ordering and matching are proposed." };
  return { raw, tree, item, preview: normalizeImportFile(data).questions[0] };
}

function editable(raw) {
  const state = inspect(raw);
  if (!state.preview) throw new Error(state.reason);
  return state;
}

function replaceTokens(raw, replacements) {
  // Descending offsets preserve all other tokens, trivia and numeric spelling.
  return replacements.sort((a, b) => b.node.offset - a.node.offset).reduce((text, { node, token }) =>
    text.slice(0, node.offset) + token + text.slice(node.offset + node.length), raw);
}

export function moveAnswer(raw, id, delta) {
  const state = editable(raw);
  if (state.item.interaction.type !== "order" || ![-1, 1].includes(delta)) throw new Error("Expected an ordering move of one position.");
  const answers = state.item.scoring.correctAnswers;
  const from = answers.indexOf(id), to = from + delta;
  if (from < 0) throw new Error("Unknown answer ID.");
  if (to < 0 || to >= answers.length) return raw;
  const nodes = [from, to].map(index => findNodeAtLocation(state.tree, ["questions", 0, "scoring", "correctAnswers", index]));
  const tokens = nodes.map(node => raw.slice(node.offset, node.offset + node.length));
  return replaceTokens(raw, nodes.map((node, index) => ({ node, token: tokens[1 - index] })));
}

export function setMatch(raw, leftId, rightId) {
  const state = editable(raw), interaction = state.item.interaction;
  if (interaction.type !== "match" || !interaction.left.some(option => option.id === leftId) || !interaction.right.some(option => option.id === rightId)) throw new Error("Unknown matching side or ID.");
  // Locate by left ID, not declaration position: valid answer arrays may use a
  // different order. Several left entries may legitimately share a right ID.
  const index = state.item.scoring.correctAnswers.findIndex(answer => JSON.parse(answer)[0] === leftId);
  const value = JSON.stringify([leftId, rightId]);
  if (state.item.scoring.correctAnswers[index] === value) return raw;
  const node = findNodeAtLocation(state.tree, ["questions", 0, "scoring", "correctAnswers", index]);
  return replaceTokens(raw, [{ node, token: JSON.stringify(value) }]);
}
