import { useId } from "react";

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
}

/** Theme-aware PrepDeck wordmark. Gradient colours are supplied by app.css. */
export default function BrandLogo({ compact = false, className }: BrandLogoProps) {
  const uid = useId().replace(/:/g, "");
  const back = `${uid}-back`;
  const middle = `${uid}-middle`;
  const front = `${uid}-front`;
  const word = `${uid}-word`;

  return (
    <svg
      className={className}
      width={compact ? 34 : 174}
      height={compact ? 34 : 36}
      viewBox={compact ? "0 0 286 286" : "0 0 1386 286"}
      role="img"
      aria-label="PrepDeck"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={back} x1="6" y1="60" x2="211" y2="232"><stop stopColor="var(--logo-back-start)"/><stop offset="1" stopColor="var(--logo-back-end)"/></linearGradient>
        <linearGradient id={middle} x1="30" y1="29" x2="239" y2="234"><stop stopColor="var(--logo-mid-start)"/><stop offset="1" stopColor="var(--logo-mid-end)"/></linearGradient>
        <linearGradient id={front} x1="89" y1="13" x2="241" y2="268"><stop stopColor="var(--logo-front-start)"/><stop offset=".55" stopColor="var(--logo-front-mid)"/><stop offset="1" stopColor="var(--logo-front-end)"/></linearGradient>
        <linearGradient id={word} x1="345" y1="220" x2="600" y2="-90"><stop stopColor="var(--logo-word-start)"/><stop offset="1" stopColor="var(--logo-word-end)"/></linearGradient>
      </defs>
      <g>
        <path d="M154.939 30.5632L33.57 56.3609C15.0298 60.3018 3.19468 78.5263 7.13553 97.0665L40.0687 252.005C44.0096 270.545 62.2341 282.38 80.7743 278.44L202.143 252.642C220.683 248.701 232.518 230.477 228.577 211.936L195.644 56.9977C191.703 38.4575 173.479 26.6224 154.939 30.5632Z" fill={`url(#${back})`}/>
        <path d="M187.545 19.5432L60.0945 31.8153C40.5017 33.7018 26.1479 51.1143 28.0345 70.7071L43.596 232.32C45.4826 251.912 62.8951 266.266 82.4879 264.38L209.938 252.108C229.531 250.221 243.885 232.808 241.998 213.216L226.437 51.6031C224.55 32.0103 207.138 17.6566 187.545 19.5432Z" fill={`url(#${middle})`}/>
        <path d="M247.589 21.2345L112.642 4.66516C91.6583 2.08866 72.5588 17.0108 69.9823 37.9947L49.2304 207.005C46.6539 227.989 61.5761 247.089 82.5599 249.665L217.507 266.235C238.49 268.811 257.59 253.889 260.166 232.905L280.918 63.8943C283.495 42.9105 268.573 23.811 247.589 21.2345Z" fill={`url(#${front})`}/>
        <path fillRule="evenodd" clipRule="evenodd" d="M109.138 49.4519L175.956 57.6561C214.606 62.4017 234.224 86.7541 229.881 122.128C225.377 158.813 199.139 177.535 160.49 172.789L137.562 169.974L131.851 216.485L89.2708 211.257L109.138 49.4519ZM147.053 92.6748L142.066 133.29L164.339 136.025C178.096 137.714 186.186 131.392 187.795 118.291C189.404 105.189 183.082 97.0986 169.326 95.4095L147.053 92.6748Z" fill="white"/>
      </g>
      {!compact && <text x="330" y="188" fill={`url(#${word})`} fontFamily="Figtree, system-ui, sans-serif" fontSize="154" fontWeight="700" letterSpacing="-7">PrepDeck</text>}
    </svg>
  );
}
