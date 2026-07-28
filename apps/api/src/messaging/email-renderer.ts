import Handlebars from 'handlebars';
import type { Branding } from '@speed-enterprises/shared';

/**
 * Render a markdown-ish template body into HTML + text. Placeholders use
 * Handlebars syntax (`{{name}}`). Bold (`**text**`) and links (`<url>`) are
 * converted to HTML; everything else passes through as text with newlines
 * preserved.
 *
 * The HTML is wrapped in a tenant-branded shell. If branding is null, a
 * neutral platform shell is used.
 */
export function renderMessage(args: {
  body: string;
  subject?: string;
  vars: Record<string, string | number | undefined | null>;
  branding?: Branding | null;
  businessName?: string;
  platformName?: string;
}): { html: string; text: string; subject: string } {
  const cleanVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(args.vars)) {
    cleanVars[k] = v == null ? '' : String(v);
  }

  const subjectTpl = Handlebars.compile(args.subject ?? '');
  const bodyTpl    = Handlebars.compile(args.body);

  const subject = subjectTpl(cleanVars).trim();
  const renderedBody = bodyTpl(cleanVars);

  const text = renderedBody;
  const html = wrapHtml(toHtml(renderedBody), {
    branding: args.branding,
    businessName: args.businessName ?? args.platformName ?? '',
    platformName: args.platformName ?? '',
  });
  return { html, text, subject };
}

// Minimal markdown → HTML: bold, line breaks, autolink. Keeps things safe.
function toHtml(s: string): string {
  // escape first
  let out = escapeHtml(s);
  // **bold**
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // URLs → links
  out = out.replace(
    /\b(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:inherit;text-decoration:underline;">${url}</a>`,
  );
  // paragraphs
  return out
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px;line-height:1.6;color:#374151;">${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function wrapHtml(bodyHtml: string, opts: { branding?: Branding | null; businessName: string; platformName: string }): string {
  const brand = opts.branding;
  const brand500 = brand?.colors.brand500 ?? '#1e63ff';
  const brand900 = brand?.colors.brand900 ?? '#0b1c3a';
  const bgColor  = '#f4f7fb';
  const cardBg   = '#ffffff';
  const inkColor = '#0b1c3a';
  const subtle   = '#7a8aa3';
  // Email clients (notably Outlook's Word engine) don't render WebP. When the
  // logo is a .webp we point email at a .png twin served from the same path —
  // by convention every .webp logo in /public/logos has a matching .png.
  const logo     = brand?.logoUrl?.replace(/\.webp(\?|$)/i, '.png$1');
  const name     = opts.businessName || opts.platformName;

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:${bgColor};margin:0;padding:24px;color:${inkColor};">
    <div style="max-width:560px;margin:0 auto;background:${cardBg};border-radius:14px;padding:28px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:22px;">
        ${logo ? `<img src="${logo}" alt="${escapeAttr(name)}" style="height:32px;width:auto;border-radius:6px;"/>` : ''}
        <span style="font-weight:700;color:${brand900};font-size:18px;">${escapeHtml(name)}</span>
      </div>
      ${bodyHtml}
      <div style="margin-top:28px;padding-top:14px;border-top:1px solid #eef2f7;color:${subtle};font-size:12px;">
        © ${escapeHtml(name)}${opts.platformName && opts.platformName !== name ? ` · powered by ${escapeHtml(opts.platformName)}` : ''}
      </div>
    </div>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
