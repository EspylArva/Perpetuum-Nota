// Scheme allowlist for user-entered links. Defense-in-depth against
// `javascript:`/`data:`/`vbscript:` href XSS — applied both when inserting a
// link (setLink) and as the editor's isAllowedUri guard. Relative URLs are
// permitted; everything with a disallowed scheme is rejected.
export const ALLOWED_LINK_PROTOCOLS = ['http', 'https', 'mailto'] as const;

// Control chars + whitespace can smuggle a scheme past naive checks
// (e.g. "java\tscript:alert(1)"). Strip them before validating.
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\x00-\x20]/g;

export function isSafeLinkUrl(raw: string): boolean {
  const url = raw.trim().replace(CONTROL_OR_SPACE, '');
  if (!url) return false;

  // Relative or anchor links carry no scheme — allow them.
  if (/^(\/|\.{1,2}\/|#|\?)/.test(url)) return true;

  // If it has a scheme, it must be in the allowlist.
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    return (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(
      schemeMatch[1].toLowerCase(),
    );
  }

  // No scheme and not obviously relative (e.g. "example.com") — treat as safe;
  // TipTap will prepend the default protocol (https).
  return true;
}
