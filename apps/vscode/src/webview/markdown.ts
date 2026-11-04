/**
 * Minimal Markdown → DOM renderer for model replies. It only ever creates
 * elements and text nodes (never innerHTML), so model output cannot inject
 * HTML or script into the panel. Supports fenced code, inline code, bold,
 * headings, lists and paragraphs — enough for chat replies.
 */

export interface Block {
  kind: "code" | "heading" | "list" | "paragraph";
  language?: string;
  level?: number;
  ordered?: boolean;
  lines: string[];
}

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = /^```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i++; // closing fence (or end of input)
      blocks.push({ kind: "code", language: fence[1] || undefined, lines: code });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, lines: [heading[2]!] });
      i++;
      continue;
    }

    const bullet = /^\s*([-*]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      // A switch between bullets and numbers starts a new list.
      while (i < lines.length && bullet.test(lines[i]!) && /^\s*\d/.test(lines[i]!) === ordered) {
        items.push(lines[i]!.replace(bullet, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered, lines: items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,4}\s/.test(lines[i]!) &&
      !bullet.test(lines[i]!)
    ) {
      paragraph.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

/** Inline `code` and **bold**; everything else is plain text. */
export function appendInline(parent: HTMLElement, text: string) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) parent.append(text.slice(last, match.index));
    const token = match[0];
    const el = document.createElement(token.startsWith("`") ? "code" : "strong");
    el.textContent = token.startsWith("`") ? token.slice(1, -1) : token.slice(2, -2);
    parent.append(el);
    last = match.index! + token.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

export function renderMarkdown(markdown: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseBlocks(markdown)) {
    switch (block.kind) {
      case "code": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        if (block.language) pre.dataset.language = block.language;
        code.textContent = block.lines.join("\n");
        pre.append(code);
        fragment.append(pre);
        break;
      }
      case "heading": {
        const h = document.createElement(`h${Math.min(6, (block.level ?? 1) + 2)}`);
        appendInline(h, block.lines[0] ?? "");
        fragment.append(h);
        break;
      }
      case "list": {
        const list = document.createElement(block.ordered ? "ol" : "ul");
        for (const item of block.lines) {
          const li = document.createElement("li");
          appendInline(li, item);
          list.append(li);
        }
        fragment.append(list);
        break;
      }
      case "paragraph": {
        const p = document.createElement("p");
        block.lines.forEach((line, i) => {
          if (i > 0) p.append(document.createElement("br"));
          appendInline(p, line);
        });
        fragment.append(p);
        break;
      }
    }
  }
  return fragment;
}
