// Shown only as a text nears its limit (issue #45), so the limit is visible
// before the field stops accepting more.
export default function LengthHint({ length, max }: { length: number; max: number }) {
  if (length < max * 0.8) return null;
  return <span className="st-muted" style={{ fontSize: 12 }} aria-live="polite">{length.toLocaleString()} / {max.toLocaleString()} characters</span>;
}
