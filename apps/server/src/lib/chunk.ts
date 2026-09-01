/**
 * Chunking markdown ~500-800 tokens com overlap 80 (lote 6).
 * Estimativa: 1 token ≈ 4 chars (igual ao prompt.ts / knowledge.ts).
 * Usa ~600 tokens por chunk, overlap 80 tokens, split por parágrafos para não quebrar markdown ao meio.
 */

const TOKENS_PER_CHUNK = 600;
const OVERLAP_TOKENS = 80;
const CHARS_PER_TOKEN = 4;

const CHARS_PER_CHUNK = TOKENS_PER_CHUNK * CHARS_PER_TOKEN; // 2400
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN; // 320

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkMarkdown(bodyMd: string, opts?: { charsPerChunk?: number; overlapChars?: number }): string[] {
  const charsPerChunk = opts?.charsPerChunk ?? CHARS_PER_CHUNK;
  const overlapChars = opts?.overlapChars ?? OVERLAP_CHARS;
  const text = bodyMd.trim();
  if (!text) return [];
  // se já cabe em um chunk, retorna único
  if (text.length <= charsPerChunk) return [text];

  // split por blocos: parágrafos duplos, depois linhas simples, mantendo estrutura
  const paragraphs = text.split(/\n{2,}/);

  const chunks: string[] = [];
  let current = "";

  function flush() {
    if (current.trim()) {
      chunks.push(current.trim());
      // overlap: mantém sufixo do current para o próximo chunk
      const overlap = current.slice(-overlapChars);
      current = overlap;
    }
  }

  for (const para of paragraphs) {
    // se parágrafo gigante > charsPerChunk, quebra por linhas/sentença
    if (para.length > charsPerChunk) {
      const lines = para.split(/\n/);
      for (const line of lines) {
        if (line.length > charsPerChunk) {
          // quebra dura por janela com overlap
          let offset = 0;
          while (offset < line.length) {
            const slice = line.slice(offset, offset + charsPerChunk);
            // tenta não quebrar no meio de palavra no fim (opcional)
            if (current.length + slice.length + 1 > charsPerChunk && current) {
              flush();
            }
            if (current) current += "\n";
            current += slice;
            if (current.length >= charsPerChunk) flush();
            offset += charsPerChunk - overlapChars;
            if (offset <= 0) break; // safety
          }
        } else {
          if (current.length + line.length + 2 > charsPerChunk && current) {
            flush();
          }
          if (current) current += "\n";
          current += line;
        }
      }
      continue;
    }

    if (current.length + para.length + 2 > charsPerChunk && current) {
      flush();
    }
    if (current && !current.endsWith("\n") && current !== current.slice(-overlapChars)) {
      // current já tem overlap; só concatena se não for overlap puro
    }
    if (current && current.length > overlapChars) {
      current += "\n\n";
    } else if (current) {
      // current é só overlap; separa
      if (current.trim()) current += "\n\n";
    }
    current += para;
    if (current.length >= charsPerChunk) flush();
  }

  if (current.trim()) chunks.push(current.trim());

  // fallback: se chunking por parágrafo gerou chunks muito pequenos (<200 chars) mescla
  // mas mantém granularidade mínima
  const merged: string[] = [];
  for (const c of chunks) {
    if (merged.length && (merged[merged.length - 1]?.length ?? 0) < 500 && c.length < 500) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n\n${c}`;
    } else {
      merged.push(c);
    }
  }

  // valida tokens aprox
  return merged.filter((c) => c.trim().length > 0);
}

// re-export para testes e uso externo
export const CHUNK_CONFIG = {
  tokensPerChunk: TOKENS_PER_CHUNK,
  overlapTokens: OVERLAP_TOKENS,
  charsPerChunk: CHARS_PER_CHUNK,
  overlapChars: OVERLAP_CHARS,
  estimateTokens,
};
