# UI principles

The user spends the day reading job posts and recruiter mail. Every screen here must cost as little reading
as possible. Apply these to every UI change, new or touched:

1. **Icon, colour or number first; words last.** Say it with an icon (lucide-react), a colour or a count
   whenever that is clear. Write words only when an icon and the layout cannot carry the meaning, and then
   as few as possible.
2. **Buttons are an icon, or an icon and one or two words.** The full meaning goes in `title` (tooltip)
   and `aria-label`, never in visible text.
3. **State is a coloured dot or badge**, not a sentence. Green = done or good, amber = needs the user,
   red = failed, slate = waiting or neutral, sky = ready.
4. **Notices are one line at most** and go away on their own where possible. Reasons and explanations are
   collapsed behind a click or a tooltip, never shown as paragraphs by default.
5. **Lists show a few, then "+N →".** A dashboard block shows its first few items (3 for tables and
   details, up to 10 for pipeline columns); the rest is one click away, on the page that owns the list or
   expanded in place.
6. **No page titles or intro paragraphs that repeat what the navigation already says.**

Every icon-only control still needs an `aria-label`, so the page stays usable with a screen reader.
