import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PdfViewer({
  url,
  fields = [],
  onFieldsChange,
  placeMode = null,
  activeSignerId = null,
}) {
  const [pages, setPages] = useState([]);
  const [error, setError] = useState("");
  const wrapRefs = useRef({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError("");
        const loadingTask = pdfjs.getDocument(url);
        const pdf = await loadingTask.promise;
        const rendered = [];
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push({
            index: i - 1,
            dataUrl: canvas.toDataURL("image/png"),
            width: viewport.width,
            height: viewport.height,
          });
        }
        if (!cancelled) setPages(rendered);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to render PDF");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  function addField(pageIndex, event) {
    if (!placeMode || !onFieldsChange) return;
    const el = wrapRefs.current[pageIndex];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xPct = (event.clientX - rect.left) / rect.width;
    const yPct = (event.clientY - rect.top) / rect.height;
    const defaults = {
      signature: { wPct: 0.28, hPct: 0.08 },
      date: { wPct: 0.18, hPct: 0.045 },
      name: { wPct: 0.24, hPct: 0.045 },
    };
    const size = defaults[placeMode] || defaults.signature;
    onFieldsChange([
      ...fields,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        type: placeMode,
        page: pageIndex,
        xPct: Math.min(Math.max(xPct - size.wPct / 2, 0), 1 - size.wPct),
        yPct: Math.min(Math.max(yPct - size.hPct / 2, 0), 1 - size.hPct),
        wPct: size.wPct,
        hPct: size.hPct,
        signerId: activeSignerId || null,
      },
    ]);
  }

  function removeField(id) {
    if (!onFieldsChange) return;
    onFieldsChange(fields.filter((f) => f.id !== id));
  }

  if (error) return <p className="error">{error}</p>;
  if (pages.length === 0) return <p className="muted">Rendering PDF…</p>;

  return (
    <div className="pdf-stage">
      {pages.map((page) => (
        <div
          key={page.index}
          className="pdf-page-wrap"
          ref={(node) => {
            wrapRefs.current[page.index] = node;
          }}
          onClick={(e) => addField(page.index, e)}
          style={{ cursor: placeMode ? "crosshair" : "default" }}
        >
          <img
            src={page.dataUrl}
            alt={`Page ${page.index + 1}`}
            style={{ width: "100%", display: "block" }}
            draggable={false}
          />
          {fields
            .filter((f) => f.page === page.index)
            .map((field) => (
              <div
                key={field.id}
                className="field-chip"
                style={{
                  left: `${field.xPct * 100}%`,
                  top: `${field.yPct * 100}%`,
                  width: `${field.wPct * 100}%`,
                  height: `${field.hPct * 100}%`,
                }}
                title="Double-click to remove"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  removeField(field.id);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {field.type}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
