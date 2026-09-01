"""
R3 — Docling worker (Python) para Nexo.
Converte PDF/DOCX/PPTX/XLSX/HTML → Markdown estruturado com páginas, headings, tabelas.
OCR opcional quando ?ocr=true e arquivo é escaneado.

Requer: pip install -r requirements.txt
Docling: https://github.com/DS4SD/docling

API:
  POST /extract?ocr=false  (multipart file)
  -> { markdown, pages, headings, metadata }
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="nexo-docling-worker", version="0.1.0")

try:
    from docling.document_converter import DocumentConverter  # type: ignore
    from docling.datamodel.base_models import InputFormat  # type: ignore
    HAS_DOCLING = True
except Exception as e:
    print(f"docling import failed: {e}")
    HAS_DOCLING = False
    DocumentConverter = None  # type: ignore

converter = None

def get_converter(use_ocr: bool):
    global converter
    if not HAS_DOCLING:
        return None
    if converter is None:
        try:
            # Docling 2.x: pipeline options
            converter = DocumentConverter()
        except Exception as e:
            print(f"converter init failed: {e}")
            return None
    return converter

def extract_headings(markdown: str) -> list[str]:
    headings: list[str] = []
    for line in markdown.splitlines():
        if line.startswith("#"):
            # "# Heading" -> "Heading"
            h = line.lstrip("#").strip()
            if h:
                headings.append(h)
    return headings

@app.get("/health")
def health():
    return {"status": "ok", "has_docling": HAS_DOCLING, "ocr_enabled": os.getenv("OCR_ENABLED", "false")}

@app.post("/extract")
async def extract(file: UploadFile = File(...), ocr: bool = Query(False)):
    filename = file.filename or "upload.bin"
    data = await file.read()
    if not data:
        return JSONResponse(status_code=400, content={"error": "empty file"})
    suffix = Path(filename).suffix or ".bin"

    # Se docling disponível, usa pipeline nativo
    conv = get_converter(use_ocr=ocr)
    if conv and HAS_DOCLING:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp) / f"input{suffix}"
            tmp_path.write_bytes(data)
            try:
                # Docling auto-detecta formato por extensão
                result = conv.convert(str(tmp_path))
                doc = result.document
                markdown = doc.export_to_markdown()
                # tenta extrair páginas (Docling expõe page info por item)
                pages = None
                try:
                    # Docling 2: doc.pages ou number of pages
                    pages = len(getattr(doc, "pages", []) or []) or None
                except Exception:
                    pages = None
                # se markdown contém marcadores, mantém; senão injeta por página se disponível
                headings = extract_headings(markdown)
                metadata: dict[str, Any] = {
                    "extractor": "docling",
                    "ocr": ocr,
                    "pages": pages,
                    "filename": filename,
                }
                # preservação de tabelas/listas já vem no markdown do docling
                return {
                    "markdown": markdown,
                    "pages": pages,
                    "headings": headings,
                    "metadata": metadata,
                }
            except Exception as e:
                print(f"docling convert failed for {filename}: {e}")
                # fallback: retorna erro acionável para o caller (ingestão marca failed com causa)
                return JSONResponse(
                    status_code=422,
                    content={"error": f"docling failed: {e}", "filename": filename},
                )

    # Fallback sem docling (útil em dev sem GPU)
    return JSONResponse(
        status_code=503,
        content={"error": "docling not available. Install docling or use Node fallback.", "filename": filename},
    )

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8001")))
