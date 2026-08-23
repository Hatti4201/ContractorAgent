const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

// The body is model-written text, so it is escaped first and only then allowed one markup form.
export function outreachBodyHtml(body: string) {
  return body
    .replace(/[&<>"]/g, (character) => escapes[character]!)
    .replace(/\*\*(?!\s)([^*\n]{1,200}?)(?<!\s)\*\*/g, "<strong>$1</strong>")
    .replace(/\r?\n/g, "<br>\n");
}
