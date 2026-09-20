export interface Breakpoints {
  phone: boolean;
  narrow: boolean;
  rail: boolean;
}

export function breakpointsFor(width: number): Breakpoints {
  const narrow = width < 900;
  const phone = width < 620;
  const rail = !narrow && width >= 1100;
  return { phone, narrow, rail };
}
