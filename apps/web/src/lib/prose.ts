// Display-only treatment of PDF layout lines. Stored text and extraction
// evidence remain unchanged. Structured code/lists/tables never use this path.
export function isProseLine(line: string): boolean {
  return !/^(?:[ \t]{2,}|\t|\s*(?:[#>|]|[-*+]\s|\d+[.)]\s|```|~~~|\$\$|\\\[|\\\]|\\(?:begin|end)\b))/.test(line)
    && !line.includes("|") && !/\S[ \t]{2,}\S/.test(line)
    && !/^\s*[\p{L}\p{N}_()[\]{}+*/^ .-]+\s*(?:=|:=|←|→|≤|≥)\s*\S/u.test(line);
}

export function proseLineSeparator(left: string, right: string): string {
  const ending = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}、。！？「」『』（）【】]$/u;
  const starting = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}、。！？「」『』（）【】]/u;
  return ending.test(left) || starting.test(right) ? "" : " ";
}

export function reflowPlainProse(text: string): string {
  // Blank lines are intentional paragraph boundaries. Be conservative around
  // mixed preformatted material that has not yet been split into typed blocks.
  return text.split(/(\r?\n(?:[ \t]*\r?\n)+)/).map(paragraph => {
    const lines = paragraph.split(/\r?\n/);
    if (lines.length < 2 || lines.some(line => !line.trim() || !isProseLine(line) || / {2,}$|\\$/.test(line))) return paragraph;
    return lines.map(line => line.trim()).reduce((result, line) => result + proseLineSeparator(result, line) + line);
  }).join("");
}
