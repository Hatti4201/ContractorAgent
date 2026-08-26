import { Fragment } from "react";

const markClass = "rounded bg-amber-200 px-0.5 font-semibold text-amber-950";

/** Marks every occurrence of the term. Built from React nodes, so the text is never treated as HTML. */
export function Highlight({ text, term }: { text: string | null | undefined; term: string }) {
  if (!text) return null;
  const needle = term.trim().toLowerCase();
  if (!needle) return <>{text}</>;

  const parts: Array<{ value: string; hit: boolean }> = [];
  let cursor = 0;
  for (;;) {
    const index = text.toLowerCase().indexOf(needle, cursor);
    if (index < 0) break;
    if (index > cursor) parts.push({ value: text.slice(cursor, index), hit: false });
    parts.push({ value: text.slice(index, index + needle.length), hit: true });
    cursor = index + needle.length;
  }
  if (!parts.length) return <>{text}</>;
  if (cursor < text.length) parts.push({ value: text.slice(cursor), hit: false });

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part.hit ? <mark className={markClass}>{part.value}</mark> : part.value}</Fragment>
      ))}
    </>
  );
}

export function MarkedText({ children }: { children: string }) {
  return <mark className={markClass}>{children}</mark>;
}
