/**
 * Splits a LinkedIn page the user copied whole (a group feed or its search results) into posts. Pure
 * and dependency-free, so the paste box can count posts as the user pastes and the server can split
 * the same text the same way.
 *
 * LinkedIn marks no post boundary in copied text. What every post does carry is its author's profile
 * link, whose text reads "<Name>View <Name>'s profile", followed by the connection degree, the
 * author's headline and a "<age> • <age> Visible to everyone" line; the post ends with its reaction
 * counts and the Like and Comment buttons.
 */

/** Room for a long feed loaded several times over, while still refusing a runaway paste. */
export const MAX_SWEEP_LENGTH = 1_500_000;
/** Enough of one post for any JD; the rest of a very long post is usually hashtags. */
export const MAX_POST_LENGTH = 6000;

export type FeedPost = {
  author: string;
  /** The author's profile, without LinkedIn's tracking query; null when the paste lost its links. */
  profileUrl: string | null;
  headline: string | null;
  /** As LinkedIn shows it, e.g. "19h" or "2d". */
  age: string | null;
  body: string;
};

// "Name's profile", or "Names' profile" for a name ending in s.
const profileMarker = /^\s*(?:\*\s*)?\[?(.+?)View (.+?)[’'](?:s)?\s+profile\s*(?:\]\((\S+?)\))?\s*$/;
const visibilityLine = /^\s*(\d+\s*[smhdwy]o?)\b.*\bVisible to\b/i;
const degreeLine = /^\s*•\s*(?:1st|2nd|3rd\+?|Following|Premium)\b/i;
const engagementLine = /^\s*\*\s*(?:[\d,]+(?:\s+(?:comments?|reposts?))?)?\s*$/i;
const markdownLink = /\[([^\]]*)\]\((https?:[^)\s]+)\)/g;
// Page furniture that follows the last post of a search results page.
const pageEnd = /^\s*(?:Show more results|Groups you might be interested in)\s*$/i;

/**
 * Mathematical bold and similar letters ("𝗺𝘀𝗿𝗶𝗻𝗶𝘃𝗮𝘀@") are how some recruiters make an address stand
 * out, and they defeat every address pattern. NFKC folds them back to plain letters.
 */
export function normalizeFeedText(text: string) {
  return text.normalize("NFKC").replace(/\r\n?/g, "\n").replace(/ /g, " ");
}

function profileUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !url.pathname.startsWith("/in/")) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Keeps a link's text and drops LinkedIn's long tracking URLs, except addresses a post itself spells out. */
function readableLine(line: string) {
  return line.replace(markdownLink, (whole, text: string, url: string) => {
    const label = text.trim();
    if (/^mailto:/i.test(url)) return label || url.slice(7);
    if (/linkedin\.com/i.test(url)) return label;
    return label && label !== url ? `${label} (${url})` : url;
  });
}

function postFrom(lines: string[]): FeedPost | null {
  const marker = profileMarker.exec(lines[0] ?? "");
  if (!marker) return null;
  let end = lines.length;
  // A post finishes with its Like and Comment buttons; whatever follows is the next post's lead-in.
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if (lines[index]!.trim() === "Comment" && lines[index - 1]!.trim() === "Like") { end = index - 1; break; }
  }
  const pageEndAt = lines.findIndex((line, index) => index > 0 && index < end && pageEnd.test(line));
  if (pageEndAt > 0) end = pageEndAt;
  const content = lines.slice(1, end);
  while (content.length && (engagementLine.test(content.at(-1)!) || !content.at(-1)!.trim())) content.pop();

  const visibleAt = content.findIndex((line) => visibilityLine.test(line));
  const header = visibleAt >= 0 ? content.slice(0, visibleAt) : [];
  const bodyLines = visibleAt >= 0 ? content.slice(visibleAt + 1) : content;
  const headline = header.find((line) => line.trim() && !degreeLine.test(line))?.trim() ?? null;
  const body = bodyLines.map(readableLine).join("\n")
    .replace(/(?:…|\.\.\.)\s*see more/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_POST_LENGTH);
  if (!body) return null;
  return {
    author: marker[2]!.trim().slice(0, 200),
    profileUrl: profileUrl(marker[3]),
    headline: headline ? readableLine(headline).slice(0, 300) : null,
    age: visibleAt >= 0 ? visibilityLine.exec(content[visibleAt]!)![1]!.replace(/\s+/g, "") : null,
    body,
  };
}

export function splitFeed(text: string): FeedPost[] {
  const lines = normalizeFeedText(text).split("\n");
  const starts = lines.flatMap((line, index) => (profileMarker.test(line) ? [index] : []));
  return starts.flatMap((start, position) => {
    const post = postFrom(lines.slice(start, starts[position + 1] ?? lines.length));
    return post ? [post] : [];
  });
}

/** The post as the pipeline reads it: the body, then who posted it, which also marks it as LinkedIn. */
export function postIntakeText(post: FeedPost) {
  const byline = [post.author, post.headline].filter(Boolean).join(" — ");
  return `${post.body}\n\nPosted on LinkedIn by ${byline}${post.profileUrl ? `\nProfile: ${post.profileUrl}` : ""}`;
}

const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Every address the post spells out, lower-cased, in order of appearance. */
export function postEmails(text: string) {
  return [...new Set((normalizeFeedText(text).match(emailPattern) ?? []).map((address) => address.replace(/\.+$/, "").toLowerCase()))];
}

export type NoiseReason = "HOTLIST" | "NOT_HIRING";

/**
 * Posts that are plainly not a job, caught without a model call. Only unmistakable markers count:
 * "NOT FOR BENCH SALES" is how a real job post turns vendors away, so bench wording alone is not one.
 */
export function obviousNoise(body: string): NoiseReason | null {
  const text = normalizeFeedText(body);
  if (/#\s*not\s*a\s*hiring\s*post\b/i.test(text)) return "NOT_HIRING";
  // Recruiters tag real jobs #OpenToWork, #Hotlist and #BenchSales for reach, so hashtags prove nothing.
  const prose = text.replace(/#[\p{L}\p{N}_]+/gu, " ");
  if (/\bhot\s*-?\s*list\b/i.test(prose)) return "HOTLIST";
  if (/\badd me (?:to|in) your (?:distribution|mailing) list\b/i.test(prose)) return "HOTLIST";
  if (/\bbench\s*sales\b/i.test(prose) && !/\bnot\s+for\s+bench\b|\bno\s+bench\b/i.test(prose) && /\bavailable\b/i.test(prose)) return "HOTLIST";
  return null;
}

/**
 * Converts what the browser put on the clipboard as HTML into the text form the splitter reads:
 * links become [text](url), so author profiles survive a paste that would otherwise keep only words.
 */
export function clipboardHtmlToText(html: string, parse: (html: string) => Document) {
  const document = parse(html);
  const blocks = new Set(["P", "DIV", "LI", "UL", "OL", "SECTION", "ARTICLE", "HEADER", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "TR"]);
  let output = "";
  const walk = (node: Node) => {
    if (node.nodeType === 3) { output += (node.textContent ?? "").replace(/\s+/g, " "); return; }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName)) return;
    if (element.tagName === "BR") { output += "\n"; return; }
    const block = blocks.has(element.tagName);
    if (block) output += "\n";
    if (element.tagName === "A" && element.getAttribute("href")?.startsWith("http")) {
      const before = output.length;
      element.childNodes.forEach(walk);
      const label = output.slice(before).replace(/\s*\n\s*/g, " ");
      output = `${output.slice(0, before)}[${label}](${element.getAttribute("href")})`;
    } else {
      element.childNodes.forEach(walk);
    }
    if (block) output += "\n";
  };
  walk(document.body);
  return output.split("\n").map((line) => line.replace(/[ \t]+$/g, "")).filter((line, index, all) => line.trim() || all[index - 1]?.trim()).join("\n").trim();
}
