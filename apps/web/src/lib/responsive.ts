export interface Breakpoints {
  phone: boolean;
  narrow: boolean;
  rail: boolean;
  landscapePhone: boolean;
}

export function breakpointsFor(width: number, height = Infinity): Breakpoints {
  const narrow = width < 900;
  const phone = width < 620;
  const rail = !narrow && width >= 1100;
  // Short phone-sized windows need reading room without changing desktop layouts.
  const landscapePhone = width >= 620 && width < 1100 && height < 500;
  return { phone, narrow, rail, landscapePhone };
}

// The padding the app shell puts around every screen. A screen that runs a bar
// edge to edge (Settings' section chips) pulls itself out by the same amount.
export function contentInset(bp: Breakpoints): { top: number; inline: number } {
  return { top: bp.phone ? 18 : bp.narrow ? 22 : 30, inline: bp.phone ? 16 : bp.narrow ? 22 : 34 };
}
