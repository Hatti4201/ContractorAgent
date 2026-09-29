/**
 * The word or two an icon stands for, shown the moment the pointer enters the block around it and
 * gone when it leaves. CSS only, so there is no delay, unlike the browser's own title tooltip. It
 * floats below the icon rather than beside it, so nothing moves when it appears.
 *
 * Each block marks itself with `labelScope[scope]`; the class names are spelled out in full here
 * because Tailwind only generates the classes it finds written in the source.
 */
const reveal = {
  nav: "group-hover/nav:opacity-100 group-focus-within/nav:opacity-100",
  bar: "group-hover/bar:opacity-100 group-focus-within/bar:opacity-100",
  row: "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
} as const;

export type LabelScope = keyof typeof reveal;

/** Put on the block whose hover reveals its labels: the whole bar, or one row of a list. */
export const labelScope: Record<LabelScope, string> = { nav: "group/nav", bar: "group/bar", row: "group/row" };

const revealInline = {
  nav: "group-hover/nav:inline group-focus-within/nav:inline",
  bar: "group-hover/bar:inline group-focus-within/bar:inline",
  row: "group-hover/row:inline group-focus-within/row:inline",
} as const;

/**
 * "float" hangs below the icon and needs a `relative` parent: the icon's own button or link. "inline"
 * sits beside the icon instead, for icons packed too close for floating labels not to overlap, such as
 * the actions at the end of a list row. Hidden from screen readers, which read the aria-label.
 */
export function HoverLabel({ text, scope, variant = "float" }: { text: string; scope: LabelScope; variant?: "float" | "inline" }) {
  if (variant === "inline") {
    return <span aria-hidden="true" className={`hidden whitespace-nowrap text-[11px] font-medium ${revealInline[scope]}`}>{text}</span>;
  }
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white opacity-0 ${reveal[scope]}`}
    >
      {text}
    </span>
  );
}
