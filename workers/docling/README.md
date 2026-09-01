# Docling worker — R3 extração

Worker Python separado que converte **PDF, DOCX, PPTX, XLSX, HTML** → Markdown estruturado com páginas, headings, tabelas e listas.

Usado pela ingestão R2/R3 (`DOCLING_WORKER_URL`). Se o worker não estiver disponível, o backend faz fallback para `pdf-parse`/`mammoth`/utf-8 e ainda gera markdown (sem Docling).

## Rodar local

```bash
cd workers/docling
pip install -r requirements.txt
python app.py  # :8001
# ou com OCR (requer tesseract no host)
OCR_ENABLED=true python app.py
```

## OCR opcional

- `POST /extract?ocr=true` ativa OCR no pipeline Docling.
- Se qualidade mínima não for atingida, a ingestão falha com `PDF_OCR_REQUIRED` / `PDF_UNREADABLE` e exige revisão manual (R3).
- Em produção, deixe `OCR_ENABLED=false` por default e só ative para PDFs escaneados conhecidos.

## Docker

```bash
docker build -t nexo-docling workers/docling
docker run -p 8001:8001 -e PORT=8001 nexo-docling
```

No `docker-compose.yml` produtivo, adicione serviço `docling-worker` (ver `docker-compose.override.example.yml`).
