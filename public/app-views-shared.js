import {
  buildEmptyState,
  escapeHtml,
  formatDateTime,
  formatMultiline,
  getFieldConfidence,
  getFieldSourceKind,
  getFieldUpdatedAt,
  getFieldValue,
  renderSourcePill,
  renderStatusPill,
  renderTag
} from "./app-utils.js";

export function simpleRow(label, value, tags = []) {
  return { label, value: value || "暂无", tags };
}

export function simpleHtmlRow(label, valueHtml, tags = []) {
  return { label, valueHtml: escapeHtml(valueHtml || "暂无"), tags };
}

export function renderFieldSection(title, field) {
  return `
    <section class="template-card section-spacer">
      <strong>${escapeHtml(title)}</strong>
      <p>${formatMultiline(getFieldValue(field) || "暂无")}</p>
      <div class="pill-list">
        ${renderSourcePill(getFieldSourceKind(field), getFieldSourceKind(field))}
        ${renderTag(formatDateTime(getFieldUpdatedAt(field)), "source-neutral")}
        ${renderTag(getFieldConfidence(field), "source-neutral")}
      </div>
    </section>
  `;
}

export function renderStringListCard(title, items, tagClass = "") {
  const list = normalizeList(items);
  return `
    <section class="template-card section-spacer">
      <strong>${escapeHtml(title)}</strong>
      ${
        list.length
          ? `<ul>${list
              .map((item) => {
                const text = typeof item === "string" ? item : item?.label || item?.title || String(item);
                return `<li>${tagClass ? renderTag(text, tagClass) : escapeHtml(text)}</li>`;
              })
              .join("")}</ul>`
          : `<div class="empty-inline">暂无</div>`
      }
    </section>
  `;
}

export function renderConsistencyBlock(consistency) {
  if (!consistency) {
    return buildEmptyState("当前没有一致性数据。");
  }

  return `
    <div class="data-list">
      ${["docs", "code", "tests"]
        .map(
          (key) => `
            <div class="data-row">
              <div>
                <strong>${escapeHtml(key)}</strong>
                <small>${escapeHtml(consistency.declared?.[key]?.note || "暂无")}</small>
              </div>
              <div class="pill-list">
                ${renderStatusPill(consistency.declared?.[key]?.status || "unknown")}
                ${renderSourcePill("declared", "declared")}
              </div>
            </div>
          `
        )
        .join("")}
      <div class="data-row"><div><strong>模式</strong><small>${escapeHtml(consistency.mode || "unknown")}</small></div></div>
      <div class="data-row"><div><strong>verified</strong><small>${escapeHtml(consistency.verified ? "available" : "not available")}</small></div></div>
    </div>
  `;
}

export function listToText(items) {
  const list = normalizeList(items).map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      return item.label || item.title || item.value || JSON.stringify(item);
    }
    return String(item);
  });

  return list.length ? list.join(" / ") : "暂无";
}

function normalizeList(items) {
  if (Array.isArray(items)) {
    return items.filter(Boolean);
  }
  if (items && typeof items === "object") {
    const value = getFieldValue(items);
    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }
    if (value === undefined || value === null || value === "") {
      return [];
    }
    return [value];
  }
  if (items === undefined || items === null || items === "") {
    return [];
  }
  return [items];
}
