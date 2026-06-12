/**
 * DOM-based post-processing for the HTML export path.
 *
 * Replaces KaTeX-rendered math wrappers with plain LaTeX delimiters so the
 * exported file is readable without KaTeX styles/scripts.
 *
 * TipTap's mathematics extension renders:
 *   - block math  as <div  data-type="block-math"  data-latex="…">…katex html…</div>
 *   - inline math as <span data-type="inline-math" data-latex="…">…katex html…</span>
 *
 * Using a regex for this is fragile because KaTeX emits nested divs — a
 * non-greedy `[\s\S]*?<\/div>` stops at the FIRST inner closing tag, leaving
 * stray markup.  DOMParser handles arbitrary nesting correctly.
 */
export function postProcessHtmlForExport(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  // Block math: replace the whole <div data-type="block-math"> with a <p>$$…$$</p>
  for (const el of Array.from(parsed.querySelectorAll('[data-type="block-math"]'))) {
    const latex = el.getAttribute('data-latex') ?? '';
    const replacement = parsed.createElement('p');
    replacement.textContent = `$$${latex}$$`;
    el.replaceWith(replacement);
  }

  // Inline math: replace <span data-type="inline-math"> with a plain text node $…$
  for (const el of Array.from(parsed.querySelectorAll('[data-type="inline-math"]'))) {
    const latex = el.getAttribute('data-latex') ?? '';
    el.replaceWith(parsed.createTextNode(`$${latex}$`));
  }

  return parsed.body.innerHTML;
}
