import React from "react";

// Minimal, safe markdown subset renderer. Returns React nodes (all text is
// escaped by React, preventing stored XSS from script/article bodies —
// docs/03 threat model "stored cross-site scripting"). Supports ## / ###
// headings, - bullet lists, and **bold** inline spans only.

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`${keyBase}-${i}`}>{p}</React.Fragment>;
  });
}

export function renderMarkdown(body: string): React.ReactNode {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      out.push(<ul key={`ul-${key++}`}>{list}</ul>);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) {
      flushList();
      out.push(<h3 key={`h-${key++}`}>{renderInline(line.slice(4), `h${key}`)}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      out.push(<h2 key={`h-${key++}`}>{renderInline(line.slice(3), `h${key}`)}</h2>);
    } else if (line.startsWith("- ")) {
      list.push(<li key={`li-${key++}`}>{renderInline(line.slice(2), `li${key}`)}</li>);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(<p key={`p-${key++}`}>{renderInline(line, `p${key}`)}</p>);
    }
  }
  flushList();
  return <>{out}</>;
}
