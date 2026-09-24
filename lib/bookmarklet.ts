// No Node imports: the install page builds the bookmarklet in the browser, from the origin it is served on.

export const MAX_CAPTURE_LENGTH = 20_000;

/**
 * The bookmarklet. It only reads what the user selected and opens a new tab: LinkedIn's content
 * policy blocks a page script from calling another site, but not from navigating to one. The text
 * travels in the fragment, which never reaches a server log, and noopener keeps LinkedIn's page from
 * reaching into the tab it opened.
 */
export function bookmarkletSource(appOrigin: string, key: string) {
  const target = JSON.stringify(`${appOrigin.replace(/\/+$/, "")}/capture#`);
  const secret = JSON.stringify(key);
  return `javascript:(()=>{const t=String(getSelection()).trim();if(!t){alert("Select the post text first (open \\"see more\\"), then click again.");return;}` +
    `const p=new URLSearchParams({k:${secret},t:t.slice(0,${MAX_CAPTURE_LENGTH}),u:location.href});` +
    `window.open(${target}+p.toString(),"_blank","noopener");})()`;
}
