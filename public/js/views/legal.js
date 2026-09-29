// Legal pages: /legal/terms, /legal/privacy, /legal/creators, /legal/refunds
import { LEGAL_DOCS, LEGAL_VERSIONS } from '../legal.js';
import { state } from '../state.js';

const ORDER = ['terms', 'privacy', 'refunds', 'creators'];

export async function render(root, [doc = 'terms']) {
  const d = LEGAL_DOCS[doc] ?? LEGAL_DOCS.terms;
  const key = LEGAL_DOCS[doc] ? doc : 'terms';
  root.innerHTML = `<div class="page legal">
    <nav class="legal-nav">${ORDER.map((k) => `<a href="/legal/${k}" data-link class="${k === key ? 'on' : ''}">${LEGAL_DOCS[k].title}</a>`).join('')}</nav>
    <article class="legal-doc">
      <div class="eyebrow">legal</div>
      <h1>${d.title}</h1>
      <p class="legal-summary">${d.summary}</p>
      <p class="muted small">Last updated ${new Date(`${LEGAL_VERSIONS[key]}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      ${state.creator?.admin ? '<div class="sample-banner"><b>Draft</b> Visible to admins only: have a lawyer review these texts and replace the [bracketed] details before launch.</div>' : ''}
      ${d.sections.map(([h, body], i) => `<section><h2><span>${i + 1}.</span> ${h}</h2><p>${body}</p></section>`).join('')}
    </article>
  </div>`;
  return null;
}
