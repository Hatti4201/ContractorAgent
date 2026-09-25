import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { obviousNoise, postEmails, postIntakeText, splitFeed } from "../lib/linkedin-feed";

// Shaped after a real copied group search page; every name, address and id is made up.
const page = readFileSync(join(__dirname, "fixtures", "linkedin-feed.txt"), "utf8");

test("a copied feed splits on the authors' profile links, with the page furniture left out", () => {
  const posts = splitFeed(page);
  assert.deepEqual(posts.map((post) => post.author), ["Avery Quinn", "Blake Morgan", "Casey Reyes", "Drew Sato"]);
  const [first, second, , last] = posts;
  assert.equal(first!.profileUrl, "https://www.linkedin.com/in/ACoAAExampleAvery01", "Tracking queries are dropped.");
  assert.equal(first!.headline, "Technical Recruiter | Example Staffing Inc");
  assert.equal(first!.age, "19h");
  assert.match(first!.body, /^We are looking for Sr\. Java Full Stack Developer/);
  assert.doesNotMatch(first!.body, /see more|Like|Comment|\* 2/, "Reactions, buttons and the fold marker are not the post.");
  assert.doesNotMatch(first!.body, /linkedin\.com/, "LinkedIn's own links keep only their text.");
  assert.doesNotMatch(second!.body, /Status is reachable|Casey/, "The next post's lead-in is not part of this one.");
  assert.equal(last!.profileUrl, "https://www.linkedin.com/in/ACoAAExampleDrew04", "A possessive after a final s still marks a post.");
  assert.doesNotMatch(last!.body, /Show more results|members|Groups you might/);
});

test("the same page pasted as plain text still splits, only without profiles", () => {
  const plain = page.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const posts = splitFeed(plain);
  assert.equal(posts.length, 4);
  assert.ok(posts.every((post) => post.profileUrl === null));
});

test("addresses written in mathematical bold are read as plain addresses", () => {
  const [, second] = splitFeed(page);
  assert.deepEqual(postEmails(second!.body), ["blake@example-vendor.test"]);
  assert.match(postIntakeText(second!), /Posted on LinkedIn by Blake Morgan — Lead - Talent Acquisition\nProfile: https:\/\/www\.linkedin\.com\/in\/ACoAAExampleBlake02$/);
});

test("only unmistakable hotlists and candidate posts are dropped without a model", () => {
  const [first, second, third, fourth] = splitFeed(page);
  assert.equal(obviousNoise(first!.body), null);
  assert.equal(obviousNoise(second!.body), null, "Recruiters tag real jobs #OpenToWork and #BenchSales.");
  assert.equal(obviousNoise(third!.body), "HOTLIST");
  assert.equal(obviousNoise(fourth!.body), "NOT_HIRING");
  assert.equal(obviousNoise("❌NOT FOR BENCH SALES❌ Java Developer, C2C, send resumes to a@b.test"), null);
});
