/**
 * R3 — Extração e normalização para Markdown estruturado.
 * Primeiro tenta Docling (worker Python) via HTTP se DOCLING_WORKER_URL estiver setado.
 * Fallback local: txt/md pass-through, pdf via pdf-parse, docx via mammoth, pptx/xlsx placeholders.
 * Preserva: título/subtítulos, página de origem, tabelas/listas (quando Docling disponível), heading, page.
 */

export type DoclingExtraction = {
  markdown: string;
  metadata: Record<string, unknown>;
  pages: number | null;
  headings: string[];
};

function extFromFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

async function extractLocal(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<DoclingExtraction> {
  const ext = extFromFilename(filename);
  const lower = filename.toLowerCase();

  if (
    ext === ".txt" ||
    ext === ".md" ||
    ext === ".markdown" ||
    ext === ".csv" ||
    ext === ".html" ||
    ext === ".htm"
  ) {
    const text = buffer.toString("utf-8");
    if (!text.trim())
      throw Object.assign(new Error("Arquivo vazio ou ilegível."), { code: "EMPTY_EXTRACTION" });
    // para html, tenta extrair texto simples (Docling faria melhor)
    const markdown = ext === ".html" || ext === ".htm" ? htmlToMarkdown(text) : text;
    const headings = extractHeadings(markdown);
    return {
      markdown,
      metadata: { extractor: ext === ".html" ? "html-fallback" : "utf8", ext, headings },
      pages: 1,
      headings,
    };
  }

  if (ext === ".pdf" || mime === "application/pdf" || lower.endsWith(".pdf")) {
    // tenta pdf-parse com tentativa de detectar páginas
    try {
      // @ts-ignore no types
      const mod: unknown = await import("pdf-parse").catch(() => null);
      const pdfParse = (
        mod as { default?: (b: Buffer) => Promise<{ text: string; numpages?: number }> }
      )?.default;
      if (pdfParse) {
        const parsed = await pdfParse(buffer);
        const raw = (parsed.text ?? "").trim();
        if (!raw) {
          // pode estar escaneado
          const ocrEnabled = process.env.OCR_ENABLED === "true";
          if (ocrEnabled) {
            throw Object.assign(
              new Error(
                "PDF escaneado detectado. OCR habilitado mas Docling worker não respondeu.",
              ),
              { code: "PDF_OCR_REQUIRED" },
            );
          }
          throw Object.assign(
            new Error(
              "PDF sem texto extraível — escaneado sem OCR. Habilite OCR ou envie PDF digital.",
            ),
            { code: "PDF_NO_TEXT" },
          );
        }
        // normaliza para markdown: detecta possíveis títulos em linhas curtas maiúsculas
        const markdown = normalizePdfTextToMarkdown(raw);
        const headings = extractHeadings(markdown);
        const pages = parsed.numpages ?? null;
        // injetar marcadores de página aproximados se houver muitas quebras
        const withPages = injectPageMarkers(markdown, pages);
        return {
          markdown: withPages,
          metadata: { extractor: "pdf-parse", pages, headings },
          pages,
          headings,
        };
      }
    } catch (e) {
      if ((e as { code?: string })?.code) throw e;
    }
    const fallback = buffer.toString("utf-8").trim();
    if (!fallback || fallback.length < 20 || /%PDF/.test(fallback.slice(0, 10))) {
      throw Object.assign(new Error("PDF ilegível ou escaneado sem OCR. Use Docling com OCR."), {
        code: "PDF_UNREADABLE",
      });
    }
    return {
      markdown: fallback,
      metadata: { extractor: "utf8-fallback", ext },
      pages: 1,
      headings: [],
    };
  }

  if (ext === ".docx") {
    try {
      const mod: unknown = await import("mammoth").catch(() => null);
      const mammoth = mod as {
        convertToHtml?: (o: { buffer: Buffer }) => Promise<{ value: string }>;
        extractRawText?: (o: { buffer: Buffer }) => Promise<{ value: string }>;
      } | null;
      if (mammoth?.convertToHtml) {
        const { value: html } = await mammoth.convertToHtml({ buffer });
        const markdown = htmlToMarkdown(html);
        const headings = extractHeadings(markdown);
        if (!markdown.trim()) throw Object.assign(new Error("DOCX vazio."), { code: "DOCX_EMPTY" });
        return {
          markdown,
          metadata: { extractor: "mammoth-html", ext, headings },
          pages: 1,
          headings,
        };
      }
      if (mammoth?.extractRawText) {
        const { value } = await mammoth.extractRawText({ buffer });
        if (!value.trim()) throw Object.assign(new Error("DOCX vazio."), { code: "DOCX_EMPTY" });
        return { markdown: value, metadata: { extractor: "mammoth", ext }, pages: 1, headings: [] };
      }
    } catch (e) {
      if ((e as { code?: string })?.code) throw e;
    }
    throw Object.assign(new Error("DOCX não pôde ser lido."), { code: "DOCX_NO_EXTRACTOR" });
  }

  if (ext === ".pptx") {
    // placeholder sem lib dedicada — Docling faria nativamente
    throw Object.assign(
      new Error(
        "PPTX requer Docling worker (python). Configure DOCLING_WORKER_URL ou converta para PDF.",
      ),
      { code: "PPTX_REQUIRES_DOCLING" },
    );
  }
  if (ext === ".xlsx") {
    throw Object.assign(
      new Error(
        "XLSX requer Docling worker (python). Configure DOCLING_WORKER_URL ou converta para CSV.",
      ),
      { code: "XLSX_REQUIRES_DOCLING" },
    );
  }

  throw Object.assign(new Error(`Extração não suportada para ${ext}`), {
    code: "UNSUPPORTED_EXTRACTION",
  });
}

export async function extractWithDocling(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<DoclingExtraction> {
  const workerUrl = process.env.DOCLING_WORKER_URL?.trim().replace(/\/$/, "");
  if (!workerUrl) {
    return extractLocal(buffer, filename, mime);
  }
  // tenta worker Python: POST /extract multipart file
  try {
    const form = new FormData();
    // @ts-ignore BlobPart dom
    const blob = new Blob([buffer as unknown as never], {
      type: mime || "application/octet-stream",
    });
    form.append("file", blob, filename);
    // sinaliza OCR opcional
    const ocr = process.env.OCR_ENABLED === "true" ? "true" : "false";
    const res = await fetch(`${workerUrl}/extract?ocr=${ocr}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Docling worker ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as {
      markdown?: string;
      pages?: number;
      headings?: string[];
      metadata?: Record<string, unknown>;
    };
    if (!json.markdown?.trim()) throw new Error("Docling retornou markdown vazio");
    const headings = json.headings ?? extractHeadings(json.markdown);
    return {
      markdown: json.markdown,
      metadata: {
        extractor: "docling",
        workerUrl,
        ...(json.metadata as Record<string, unknown> | undefined),
        headings,
      },
      pages: json.pages ?? null,
      headings,
    };
  } catch (e) {
    console.warn(
      "Docling worker falhou, fallback local",
      e instanceof Error ? e.message : String(e),
    );
    return extractLocal(buffer, filename, mime);
  }
}

function htmlToMarkdown(html: string): string {
  // conversão simples html→markdown para fallback mammoth
  return html
    .replace(
      /<h([1-6])[^>]*>(.*?)<\/h\1>/gi,
      (_m, lvl: string, t: string) => `${"#".repeat(Number(lvl))} ${stripTags(t).trim()}\n\n`,
    )
    .replace(/<li[^>]*>(.*?)<\/li>/gi, (_m, t: string) => `- ${stripTags(t).trim()}\n`)
    .replace(/<p[^>]*>(.*?)<\/p>/gi, (_m, t: string) => `${stripTags(t).trim()}\n\n`)
    .replace(/<br[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) headings.push(m[1]!.trim());
  }
  return headings;
}

function normalizePdfTextToMarkdown(raw: string): string {
  // Heurística leve: linhas curtas em caixa alta ou com numeração são promovidas a heading
  const lines = raw.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    // ex: "1. Introdução" ou "INTRODUÇÃO" (curta < 60 chars, muitas maiúsculas)
    const isHeading =
      /^(\d+(\.\d+)*\s+)?[A-ZÁÂÃÉÊÍÓÔÕÚÇ][A-ZÁÂÃÉÊÍÓÔÕÚÇ\s-]{8,60}$/.test(trimmed) &&
      trimmed.length < 80;
    if (isHeading && trimmed.length < 60) {
      out.push(`## ${trimmed}`);
    } else {
      out.push(line);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function injectPageMarkers(markdown: string, pages: number | null): string {
  if (!pages || pages <= 1 || markdown.includes("<!-- page:")) return markdown;
  // injeta marcadores a cada ~3000 chars para simular páginas até Docling real
  const chunkSize = Math.ceil(markdown.length / pages);
  let result = "";
  for (let i = 0, page = 1; i < markdown.length; i += chunkSize, page++) {
    result += `<!-- page: ${page} -->\n`;
    result += markdown.slice(i, i + chunkSize);
    result += "\n\n";
  }
  return result.trim();
}
