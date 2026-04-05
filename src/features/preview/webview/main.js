// @ts-nocheck — webview script runs in browser context, not TS-checked
(function () {
  const vscode = acquireVsCodeApi();
  const header = document.getElementById("header");
  const content = document.getElementById("content");

  // Current sort state
  let _columns = [];
  let _rows = [];
  let _sortCol = -1;
  let _sortAsc = true;

  /**
   * Escapes HTML special characters to prevent XSS when rendering cell values.
   * @param {unknown} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Renders the results table.
   * @param {string[]} columns
   * @param {string[][]} rows
   * @param {string} modelName
   */
  function renderResults(columns, rows, modelName) {
    _columns = columns;
    _rows = rows;

    // Header
    header.innerHTML = `<h2 class="preview-title">${escapeHtml(modelName)}</h2>
      <p class="row-count">${rows.length} row${rows.length !== 1 ? "s" : ""}</p>`;

    // Table
    renderTable();
  }

  /**
   * Renders (or re-renders) the sorted table into #content.
   */
  function renderTable() {
    let displayRows = _rows.slice();

    if (_sortCol >= 0) {
      displayRows.sort((a, b) => {
        const av = a[_sortCol] ?? "";
        const bv = b[_sortCol] ?? "";
        // Numeric comparison when both values look numeric
        const an = parseFloat(av);
        const bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) {
          return _sortAsc ? an - bn : bn - an;
        }
        return _sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    const colHeaders = _columns
      .map((col, i) => {
        let indicator = "";
        if (_sortCol === i) {
          indicator = _sortAsc ? " ▲" : " ▼";
        }
        return `<th data-col="${i}" title="Click to sort by ${escapeHtml(col)}">${escapeHtml(col)}${indicator}</th>`;
      })
      .join("");

    const dataRows = displayRows
      .map((row) => {
        const cells = _columns
          .map((_, i) => `<td>${escapeHtml(row[i] ?? "")}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    content.innerHTML = `
      <div class="table-container">
        <table>
          <thead><tr>${colHeaders}</tr></thead>
          <tbody>${dataRows}</tbody>
        </table>
      </div>`;

    // Attach sort listeners
    content.querySelectorAll("th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = parseInt(th.getAttribute("data-col") ?? "-1", 10);
        if (col < 0) return;
        if (_sortCol === col) {
          _sortAsc = !_sortAsc;
        } else {
          _sortCol = col;
          _sortAsc = true;
        }
        renderTable();
      });
    });
  }

  /**
   * Renders an error message.
   * @param {string} errorText
   * @param {string} modelName
   * @param {string} command
   */
  function renderError(errorText, modelName, command) {
    header.innerHTML = `<h2 class="preview-title error-title">Error: ${escapeHtml(modelName)}</h2>
      <p class="error-command"><code>${escapeHtml(command)}</code></p>`;

    const errorId = "error-text-block";
    content.innerHTML = `
      <div class="error-container">
        <button class="copy-btn" id="copy-btn">Copy Error</button>
        <pre id="${errorId}" class="error-block">${escapeHtml(errorText)}</pre>
      </div>`;

    document.getElementById("copy-btn")?.addEventListener("click", () => {
      vscode.postMessage({ type: "copy", text: errorText });
    });
  }

  // Signal to the extension that the webview is ready to receive messages.
  vscode.postMessage({ type: "ready" });

  // Listen for messages from the extension host
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !message.type) return;

    switch (message.type) {
      case "results":
        renderResults(
          message.columns ?? [],
          message.rows ?? [],
          message.modelName ?? "",
        );
        break;
      case "error":
        renderError(
          message.error ?? "",
          message.modelName ?? "",
          message.command ?? "",
        );
        break;
    }
  });
})();
