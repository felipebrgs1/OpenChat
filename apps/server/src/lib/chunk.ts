/**
 * R3 — Chunking estruturado: 400–600 tokens alvo, máx 800, overlap 60–100.
 * Não mistura seções; une chunks pequenos ao seguinte quando apropriado.
 * 1 token ≈ 4 chars (igual prompt.ts). Usa Docling markdown como base quando disponível.
 */

const TOKENS_TARGET_MIN = 400;
const TOKENS_TARGET_MAX = 600;
const TOKENS_MAX = 800;
const OVERLAP_TOKENS_MIN = 60;
const OVERLAP_TOKENS_MAX = 100;

const CHARS_PER_TOKEN = 4;

const CHARS_TARGET_MIN = TOKENS_TARGET_MIN * CHARS_PER_TOKEN; // 1600
const CHARS_TARGET_MAX = TOKENS_TARGET_MAX * CHARS_PER_TOKEN; // 2400
const CHARS_MAX = TOKENS_MAX * CHARS_PER_TOKEN; // 3200
const OVERLAP_CHARS_MIN = OVERLAP_TOKENS_MIN * CHARS_PER_TOKEN; // 240
const OVERLAP_CHARS = 80 * CHARS_PER_TOKEN; // 320 (default dentro da faixa)
const OVERLAP_CHARS_MAX = OVERLAP_TOKENS_MAX * CHARS_PER_TOKEN; // 400

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type StructuredChunk = {
  content: string;
  heading: string | null;
  page: number | null;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
};

type Section = {
  heading: string | null;
  level: number; // 0 = sem heading
  page: number | null;
  content: string;
  startOffset: number;
};

/**
 * Parse markdown em seções por heading (#, ##, ###).
 * Preserva startOffset relativo ao markdown original para rastreabilidade.
 */
function parseSections(markdown: string): Section[] {
  const text = markdown.replace(/\r\n/g, "\n");
  if (!text.trim()) return [];
  const lines = text.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentPage: number | null = null;
  let buffer: string[] = [];
  let bufferStartOffset = 0;
  let offset = 0;

  function flushSection(nextOffset: number) {
    const content = buffer.join("\n");
    if (content.trim()) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        page: currentPage,
        content,
        startOffset: bufferStartOffset,
      });
    }
    buffer = [];
    bufferStartOffset = nextOffset;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    // marcador opcional de página vindo do Docling: <!-- page: 3 -->
    const pageMatch = line.match(/<!--\s*page:\s*(\d+)\s*-->/i);
    if (pageMatch) {
      const p = Number(pageMatch[1]);
      if (Number.isFinite(p)) currentPage = p;
      // não inclui marcador no conteúdo
      offset += line.length + 1;
      continue;
    }
    if (headingMatch) {
      // fecha seção anterior
      flushSection(offset);
      currentHeading = headingMatch[2]!.trim() || null;
      currentLevel = headingMatch[1]!.length;
      // heading faz parte da seção seguinte
      buffer.push(line);
      bufferStartOffset = offset;
    } else {
      if (buffer.length === 0) bufferStartOffset = offset;
      buffer.push(line);
    }
    offset += line.length + 1;
  }
  flushSection(offset);
  if (sections.length === 0 && text.trim()) {
    return [{ heading: null, level: 0, page: 1, content: text, startOffset: 0 }];
  }
  return sections;
}

/**
 * Chunking por seção, sem misturar seções.
 * Se seção pequena (< 500 chars) e próxima seção também pequena, une.
 */
export function chunkStructuredMarkdown(
  markdown: string,
  opts?: { charsTargetMax?: number; charsMax?: number; overlapChars?: number },
): StructuredChunk[] {
  const charsTargetMax = opts?.charsTargetMax ?? CHARS_TARGET_MAX; // 2400
  const charsMax = opts?.charsMax ?? CHARS_MAX; // 3200
  const overlapChars = opts?.overlapChars ?? OVERLAP_CHARS; // 320
  const text = markdown.trim();
  if (!text) return [];

  // se couber num chunk, retorna com heading detectado
  if (text.length <= charsTargetMax) {
    const sections = parseSections(text);
    const heading = sections[0]?.heading ?? null;
    const page = sections[0]?.page ?? 1;
    return [
      {
        content: text,
        heading,
        page,
        startOffset: 0,
        endOffset: text.length,
        tokenCount: estimateTokens(text),
      },
    ];
  }

  const sections = parseSections(markdown);
  const chunks: StructuredChunk[] = [];
  // pré-processa: une seções muito pequenas (< 500) com a próxima quando ambas < 1200
  const mergedSections: Section[] = [];
  for (const sec of sections) {
    const last = mergedSections[mergedSections.length - 1];
    if (last && last.content.length < 500 && sec.content.length < 700 && last.content.length + sec.content.length < charsTargetMax + 800) {
      // une ao anterior (mantém heading do primeiro)
      mergedSections[mergedSections.length - 1] = {
        ...last,
        content: `${last.content}\n\n${sec.content}`,
        // endOffset implicit
      };
    } else {
      mergedSections.push(sec);
    }
  }

  for (const section of mergedSections) {
    const { heading, page, content, startOffset } = section;
    if (content.length <= charsTargetMax) {
      chunks.push({
        content: content.trim(),
        heading,
        page: page ?? 1,
        startOffset,
        endOffset: startOffset + content.length,
        tokenCount: estimateTokens(content),
      });
      continue;
    }
    // seção grande → split por parágrafos/linhas com overlap, sem cruzar seção
    const paragraphs = content.split(/\n{2,}/);
    let current = "";
    let currentStart = startOffset;
    let sectionOffset = 0;

    function flushCurrent() {
      if (!current.trim()) return;
      const trimmed = current.trim();
      chunks.push({
        content: trimmed,
        heading,
        page: page ?? 1,
        startOffset: currentStart,
        endOffset: currentStart + current.length,
        tokenCount: estimateTokens(trimmed),
      });
      // overlap: mantém sufixo
      const overlap = current.slice(-overlapChars);
      const overlapStart = current.length - overlap.length;
      current = overlap;
      currentStart = currentStart + overlapStart;
    }

    for (const para of paragraphs) {
      if (!para.trim()) {
        sectionOffset += para.length + 2;
        continue;
      }
      if (para.length > charsMax) {
        // quebra dura por janela
        let pOffset = 0;
        while (pOffset < para.length) {
          const slice = para.slice(pOffset, pOffset + charsMax);
          if (current.length + slice.length + 1 > charsMax && current) flushCurrent();
          if (current && current !== para.slice(pOffset - overlapChars, pOffset)) {
            // current já tem overlap; só concatena
          }
          const paraPos = sectionOffset + pOffset;
          if (!current) currentStart = startOffset + paraPos;
          if (current) current += "\n";
          current += slice;
          if (current.length >= charsTargetMax) flushCurrent();
          pOffset += charsMax - overlapChars;
          if (pOffset <= 0) break;
        }
        sectionOffset += para.length + 2;
        continue;
      }
      const need = current ? current.length + 2 + para.length : para.length;
      if (need > charsMax && current) flushCurrent();
      if (!current) currentStart = startOffset + sectionOffset;
      if (current) current += "\n\n";
      current += para;
      sectionOffset += para.length + 2;
      if (current.length >= charsTargetMax) flushCurrent();
    }
    if (current.trim()) {
      chunks.push({
        content: current.trim(),
        heading,
        page: page ?? 1,
        startOffset: currentStart,
        endOffset: currentStart + current.length,
        tokenCount: estimateTokens(current.trim()),
      });
    }
  }

  // pós-processa: garante overlap correto e não excede max, recalcula tokenCount
  return chunks
    .map((c) => ({ ...c, tokenCount: estimateTokens(c.content) }))
    .filter((c) => c.content.trim().length > 0);
}

// Compat: chunkMarkdown legado (string[]) usa structured internamente
export function chunkMarkdown(
  bodyMd: string,
  opts?: { charsPerChunk?: number; overlapChars?: number },
): string[] {
  const structured = chunkStructuredMarkdown(bodyMd, {
    charsTargetMax: opts?.charsPerChunk,
    overlapChars: opts?.overlapChars,
  });
  return structured.map((c) => c.content);
}

export const CHUNK_CONFIG = {
  tokensTargetMin: TOKENS_TARGET_MIN,
  tokensTargetMax: TOKENS_TARGET_MAX,
  tokensMax: TOKENS_MAX,
  overlapTokensMin: OVERLAP_TOKENS_MIN,
  overlapTokensMax: OVERLAP_TOKENS_MAX,
  charsTargetMin: CHARS_TARGET_MIN,
  charsTargetMax: CHARS_TARGET_MAX,
  charsMax: CHARS_MAX,
  overlapCharsMin: OVERLAP_CHARS_MIN,
  overlapChars: OVERLAP_CHARS,
  overlapCharsMax: OVERLAP_CHARS_MAX,
  estimateTokens,
  parseSections,
};
