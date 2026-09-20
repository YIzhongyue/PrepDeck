// implementation — what both Recharts cards need in order to be usable without
// seeing them: a text summary, a keyboard-reachable table of the same numbers,
// and a way to switch the animations off when the viewer asked for that.

import { useEffect, useState, type ReactNode } from "react";

/** Live: a viewer who changes the OS setting gets the new behaviour without a
 *  reload, which matters because the charts re-render on every data refresh. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * The data alternative every chart on this screen carries. The chart itself is
 * hidden from assistive technology (it is a picture of these numbers), the
 * summary sentence names what it shows, and the table holds every value.
 */
export function ChartData({
  summary, caption, columns, rows,
}: {
  summary: string;
  caption: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <>
      <p className="sr-only">{summary}</p>
      <details className="pd-stats-data">
        <summary>Show the numbers</summary>
        <div className="pd-stats-data-scroll">
          <table>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={columns.length}>No data yet.</td></tr>
                : rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
