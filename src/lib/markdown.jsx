import React from 'react';
import { marked } from 'marked';
import styles from '../styles';

marked.setOptions({ breaks: true, gfm: true });

const mdStyle = document.createElement('style');
mdStyle.textContent = `
  .md h1,.md h2,.md h3,.md h4 { font-weight:700; margin:12px 0 4px; color:#1a1a19; line-height:1.3 }
  .md h1 { font-size:17px } .md h2 { font-size:15px } .md h3 { font-size:14px }
  .md p { margin:0 0 8px } .md p:last-child { margin-bottom:0 }
  .md ul,.md ol { margin:4px 0 8px 18px; padding:0 } .md li { margin-bottom:2px }
  .md code { background:#f3f2ee; border:1px solid #e5e3dc; border-radius:3px; padding:1px 5px; font-family:var(--mono); font-size:12px }
  .md pre { background:#1a1a19; border-radius:6px; padding:12px 14px; overflow-x:auto; margin:8px 0 }
  .md pre code { background:none; border:none; padding:0; color:#f3f2ee; font-size:12px; line-height:1.6 }
  .md strong { font-weight:700 } .md em { font-style:italic; color:#5c5c54 }
  .md blockquote { border-left:3px solid #e5e3dc; margin:0; padding:0 12px; color:#5c5c54 }
  .md a { color:#d97706; text-decoration:none } .md hr { border:none; border-top:1px solid #e5e3dc; margin:12px 0 }
  .think-block { background:#f9f8f5; border:1px solid #e5e3dc; border-radius:6px; padding:8px 12px; margin-bottom:8px; font-size:11px; color:#8c8c84; font-style:italic; white-space:pre-wrap; word-break:break-word }
  .think-label { font-size:12px; font-weight:400; font-style:italic; color:#8c8c84; margin-bottom:4px }
`;
document.head.appendChild(mdStyle);

export function sanitizeHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script, iframe, object, embed, form').forEach((el) => el.remove());
  tmp.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) { el.removeAttribute(attr.name); continue; }
      if ((attr.name === 'href' || attr.name === 'src') && /^javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return tmp.innerHTML;
}

export function MarkdownContent({ text }) {
  const html = sanitizeHtml(marked.parse(text || ''));
  return <div className="md" style={styles.markdownBody} dangerouslySetInnerHTML={{ __html: html }} />;
}
