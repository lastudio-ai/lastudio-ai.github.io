const CATALOG_URL = window.catalogUrl || "./data/catalog.json";
const CAPABILITY_META = {
  tts: { label: "TTS", className: "icon-tts", title: "Text to speech" },
  "voice-cloning": { label: "C", className: "icon-clone", title: "Voice cloning" },
  "voice-design": { label: "D", className: "icon-design", title: "Voice design" },
  stt: { label: "S", className: "icon-stt", title: "Speech to text" }
};

const state = {
  models: [],
  query: "",
  capabilities: new Set(Object.keys(CAPABILITY_META)),
  sort: "featured",
  selectedModelId: null
};

const elements = {
  list: document.querySelector("#model-list"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#result-count"),
  version: document.querySelector("#catalog-version"),
  search: document.querySelector("#model-search"),
  sort: document.querySelector("#sort-models"),
  capabilityInputs: document.querySelectorAll(".capability-filter input"),
  template: document.querySelector("#model-card-template"),
  shell: document.querySelector(".catalog-shell"),
  detailPane: document.querySelector("#model-detail-pane"),
  detailTemplate: document.querySelector("#model-detail-template"),
  hero: document.querySelector(".hero"),
  pageLayout: document.querySelector("#model-page-layout")
};

init();

async function init() {
  try {
    const response = await fetch(CATALOG_URL);
    if (!response.ok) {
      throw new Error(`Catalog request failed: ${response.status}`);
    }

    const catalog = await response.json();
    state.models = buildModels(catalog);
    elements.version.textContent = `Catalog ${catalog.version || "local"}`;
    bindControls();

    const initialModelId = getModelIdFromUrl();
    if (initialModelId) {
      state.selectedModelId = initialModelId;
    }

    render();
  } catch (error) {
    elements.count.textContent = "Unable to load catalog.";
    elements.empty.hidden = false;
    elements.empty.textContent = error.message;
  }
}

function bindControls() {
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  elements.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  elements.capabilityInputs.forEach((input) => {
    input.addEventListener("change", () => {
      state.capabilities = new Set(
        Array.from(elements.capabilityInputs)
          .filter((item) => item.checked)
          .map((item) => item.value)
      );
      render();
    });
  });

  window.addEventListener("hashchange", () => {
    const modelId = getModelIdFromUrl();
    if (modelId !== state.selectedModelId) {
      state.selectedModelId = modelId;
      render();
    }
  });
}

function buildModels(catalog) {
  const families = [...(catalog.ttsFamilies || []), ...(catalog.sttFamilies || [])];
  const categoryItems = flattenCategoryItems(catalog.modelCategories || []);
  const pickOrder = new Map();

  (catalog.modelPicks || []).forEach((collection) => {
    (collection.items || []).forEach((item, index) => {
      if (!pickOrder.has(item.familyId)) {
        pickOrder.set(item.familyId, index);
      }
    });
  });

  return families.map((family, index) => {
    const relatedItems = categoryItems.filter((item) => {
      return item.realId === family.modelId || item.localDir === family.localDir || item.id === family.id;
    });
    const files = uniqueFiles([
      ...(family.requiredFiles || []),
      ...relatedItems.flatMap((item) => item.variants || []),
      ...relatedItems.flatMap((item) => (item.components || []).flatMap((component) => component.variants || []))
    ]);
    const categories = unique(relatedItems.map((item) => item.categoryTitle).filter(Boolean));
    const params = firstValue([family.params, ...relatedItems.map((item) => item.params)]);
    const tags = unique([...(family.tags || []), ...relatedItems.flatMap((item) => item.tags || [])]);
    const languageCount = family.supportedLanguageCount || (family.supportedLanguages || family.featuredLanguages || []).length;
    const runtimes = unique((family.runtimes || []).map((runtime) => runtime.label || runtime.name).filter(Boolean));

    return {
      id: family.id,
      title: family.title || family.shortName || family.id,
      subtitle: family.subtitle || "",
      description: family.description || firstValue(relatedItems.map((item) => item.desc)) || "",
      modelId: family.modelId,
      modelPath: family.modelPath,
      thumbnail: family.hubFiles?.thumbnail || null,
      capabilities: family.capabilities || [],
      categories,
      params,
      tags,
      languageCount,
      files,
      runtimes,
      stats: family.stats || {},
      readme: family.hubFiles?.readme?.content || "",
      order: pickOrder.has(family.id) ? pickOrder.get(family.id) : 100 + index
    };
  });
}

function flattenCategoryItems(categories) {
  return categories.flatMap((category) => {
    return (category.items || []).map((item) => ({
      ...item,
      categoryId: category.id,
      categoryTitle: category.title || category.name
    }));
  });
}

function uniqueFiles(files) {
  const seen = new Set();
  return files
    .filter((file) => file && file.file)
    .filter((file) => {
      const key = `${file.file}:${file.size || ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function render() {
  if (window.initialModelId) {
    if (elements.hero) elements.hero.hidden = true;
    if (elements.shell) elements.shell.hidden = true;
    if (elements.pageLayout) {
      elements.pageLayout.hidden = false;
      const currentModel = state.models.find(
        (m) => m.modelId === window.initialModelId || m.id === window.initialModelId
      );
      if (currentModel) {
        renderModelPage(currentModel);
      } else {
        elements.pageLayout.textContent = "Model not found in catalog.";
      }
    }
    return;
  }

  if (elements.hero) elements.hero.hidden = false;
  if (elements.shell) elements.shell.hidden = false;
  if (elements.pageLayout) elements.pageLayout.hidden = true;

  const models = filteredModels();
  elements.list.replaceChildren(...models.map(renderCard));
  elements.empty.hidden = models.length !== 0;
  elements.count.textContent = `${models.length} of ${state.models.length} models`;

  const selectedModel = state.models.find(
    (m) => m.modelId === state.selectedModelId || m.id === state.selectedModelId
  );
  renderDetailPane(selectedModel);
}

function filteredModels() {
  return state.models
    .filter((model) => {
      const hasCapability = model.capabilities.some((capability) => state.capabilities.has(capability));
      const text = [
        model.title,
        model.subtitle,
        model.description,
        model.modelId,
        ...model.capabilities,
        ...model.categories,
        ...model.tags
      ].join(" ").toLowerCase();

      return hasCapability && (!state.query || text.includes(state.query));
    })
    .sort(compareModels);
}

function compareModels(a, b) {
  if (state.sort === "name") {
    return a.title.localeCompare(b.title);
  }

  if (state.sort === "parameters") {
    return parseParameters(b.params) - parseParameters(a.params) || a.title.localeCompare(b.title);
  }

  if (state.sort === "files") {
    return b.files.length - a.files.length || a.title.localeCompare(b.title);
  }

  return a.order - b.order || a.title.localeCompare(b.title);
}

function renderCard(model) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".model-card");
  const title = fragment.querySelector("h2");
  const modelId = fragment.querySelector(".model-id");
  const description = fragment.querySelector(".description");
  const icons = fragment.querySelector(".capability-icons");
  const meta = fragment.querySelector(".meta-grid");
  const tags = fragment.querySelector(".tag-row");
  const files = fragment.querySelector(".files-list");
  const repoLink = fragment.querySelector(".repo-link");
  const updated = fragment.querySelector(".updated-label");

  title.textContent = model.title;
  if (model.params) {
    title.appendChild(createBadge(model.params, "param-badge"));
  }

  modelId.textContent = model.modelId || model.id;
  description.textContent = model.description;
  icons.replaceChildren(...model.capabilities.map(createCapabilityIcon));

  meta.replaceChildren(
    createMetaItem("Capabilities", model.capabilities.map(formatCapability).join(", ")),
    createMetaItem("Languages", model.languageCount ? `${model.languageCount}` : "Curated"),
    createMetaItem("Files", `${model.files.length}`),
    createMetaItem("Runtimes", model.runtimes.length ? model.runtimes.join(", ") : "Local")
  );

  tags.replaceChildren(...model.tags.slice(0, 8).map((tag) => createBadge(tag, "tag")));
  files.replaceChildren(...model.files.slice(0, 12).map(renderFile));

  if (model.id === state.selectedModelId || model.modelId === state.selectedModelId) {
    card.classList.add("is-active");
  }

  card.addEventListener("click", (e) => {
    if (e.target.tagName === "A" && e.target.classList.contains("repo-link")) {
      return;
    }
    selectModel(model.modelId || model.id);
  });

  const basePath = window.initialModelId ? "../../../" : "./";
  if (model.modelPath) {
    repoLink.href = `${basePath}models/${model.modelPath}/index.html`;
  } else {
    repoLink.href = `#/models/${model.modelId || model.id}`;
  }
  repoLink.textContent = "Model details";
  updated.textContent = model.categories.length ? model.categories.join(" / ") : "LA Studio curated";

  if (!model.description) {
    description.hidden = true;
  }

  if (!model.files.length) {
    card.querySelector(".files-panel").hidden = true;
  }

  return fragment;
}

function renderFile(file) {
  const row = document.createElement("div");
  row.className = "file-row";

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = file.file;

  const size = document.createElement("span");
  size.className = "file-size";
  size.textContent = file.size || file.name || "required";

  row.append(name, size);
  return row;
}

function createCapabilityIcon(capability) {
  const meta = CAPABILITY_META[capability] || { label: capability.slice(0, 1).toUpperCase(), className: "", title: capability };
  const icon = document.createElement("span");
  icon.className = `icon ${meta.className}`;
  icon.title = meta.title;
  icon.setAttribute("aria-label", meta.title);
  icon.textContent = meta.label;
  return icon;
}

function createMetaItem(label, value) {
  const item = document.createElement("div");
  item.className = "meta-item";

  const labelElement = document.createElement("span");
  labelElement.className = "meta-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("span");
  valueElement.className = "meta-value";
  valueElement.title = value || "None";
  valueElement.textContent = value || "None";

  item.append(labelElement, valueElement);
  return item;
}

function createBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = text;
  return badge;
}

function formatCapability(capability) {
  const names = {
    tts: "TTS",
    "voice-cloning": "Cloning",
    "voice-design": "Design",
    stt: "STT"
  };
  return names[capability] || capability;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function firstValue(values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseParameters(value) {
  if (!value) {
    return 0;
  }

  const match = String(value).match(/([\d.]+)\s*([bBmMkK])?/);
  if (!match) {
    return 0;
  }

  const number = Number(match[1]);
  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "b") {
    return number * 1000;
  }
  if (suffix === "k") {
    return number / 1000;
  }
  return number;
}

function getModelIdFromUrl() {
  if (window.initialModelId) {
    return window.initialModelId;
  }
  const hash = window.location.hash;
  if (hash.startsWith("#/models/")) {
    return hash.replace("#/models/", "");
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("model")) {
    return params.get("model");
  }
  const path = window.location.pathname;
  const match = path.match(/\/models\/([^/]+\/[^/]+)\/?$/);
  if (match) {
    return match[1];
  }
  return null;
}

function selectModel(modelId) {
  state.selectedModelId = modelId;
  if (modelId) {
    window.location.hash = `#/models/${modelId}`;
  } else {
    if (window.location.hash.startsWith("#/models/")) {
      window.location.hash = "";
    }
  }
  render();
}

function renderDetailPane(model) {
  if (!model) {
    elements.detailPane.hidden = true;
    elements.shell.classList.remove("has-selected-model");
    return;
  }

  elements.shell.classList.add("has-selected-model");
  elements.detailPane.hidden = false;

  const fragment = elements.detailTemplate.content.cloneNode(true);
  
  fragment.querySelector(".detail-title").textContent = model.modelId || model.id;
  fragment.querySelector(".detail-desc").textContent = model.subtitle || model.description;
  
  fragment.querySelector(".copy-id-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(model.modelId || model.id);
    const btn = elements.detailPane.querySelector(".copy-id-btn");
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '✓';
    setTimeout(() => {
      if (btn) btn.innerHTML = originalHTML;
    }, 1500);
  });

  const downloads = model.stats?.displayDownloads || model.stats?.upstreamDownloads || 0;
  const likes = model.stats?.upstreamLikes || 0;
  const rawDate = model.stats?.updatedAt;
  
  fragment.querySelector(".downloads-stat").textContent = `↓ ${downloads.toLocaleString()}`;
  fragment.querySelector(".likes-stat").textContent = `★ ${likes.toLocaleString()}`;
  fragment.querySelector(".updated-stat").textContent = rawDate 
    ? `Last updated: ${new Date(rawDate).toLocaleDateString()}` 
    : "LA Studio curated";

  const isPick = state.models.some(m => m.id === model.id && m.order < 100);
  if (!isPick) {
    fragment.querySelector(".staff-pick-badge").style.display = "none";
  }

  fragment.querySelector(".params-chip").textContent = `Params: ${model.params || "N/A"}`;
  
  const arch = model.tags.find(t => ["gguf", "ggml", "safetensors"].indexOf(t.toLowerCase()) === -1) || model.id.split("-")[0];
  fragment.querySelector(".arch-chip").textContent = `Arch: ${arch}`;

  const capsContainer = fragment.querySelector(".detail-capabilities-list");
  capsContainer.replaceChildren(...model.capabilities.map(createCapabilityIcon));

  const select = fragment.querySelector(".variant-select");
  const downloadBtn = fragment.querySelector(".download-action-btn");
  
  select.replaceChildren(
    ...model.files.map((file) => {
      const opt = document.createElement("option");
      opt.value = file.file;
      opt.textContent = `${file.file} (${file.size || "Required"})`;
      return opt;
    })
  );

  const updateDownloadLink = () => {
    const selectedFile = select.value;
    if (model.modelId && selectedFile) {
      downloadBtn.href = `https://huggingface.co/${model.modelId}/resolve/main/${selectedFile}`;
      downloadBtn.style.display = "inline-block";
    } else {
      downloadBtn.href = "#";
      downloadBtn.style.display = "none";
    }
  };

  select.addEventListener("change", updateDownloadLink);
  updateDownloadLink();

  const readmeContent = fragment.querySelector(".readme-content");
  if (model.readme) {
    readmeContent.innerHTML = renderMarkdown(model.readme);
  } else {
    readmeContent.textContent = "No README available for this model.";
  }

  fragment.querySelector(".close-detail-btn").addEventListener("click", () => {
    selectModel(null);
  });

  elements.detailPane.replaceChildren(fragment);
}

function renderMarkdown(md) {
  if (!md) return "";
  
  const codeBlocks = [];
  let html = md.replace(/```([\s\S]*?)```/g, (match, code) => {
    codeBlocks.push(code);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
    return `<pre><code>${codeBlocks[index].trim()}</code></pre>`;
  });

  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');

  html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  html = html.split(/\n{2,}/).map(p => {
    if (p.trim().startsWith('<h') || p.trim().startsWith('<pre') || p.trim().startsWith('<ul') || p.trim().startsWith('<ol')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

function estimateMinMemory(model) {
  const params = model.params || "";
  const paramsLower = params.toLowerCase();
  if (paramsLower.includes("b")) {
    const val = parseFloat(paramsLower);
    if (val < 1) return "2 GB";
    if (val < 3) return "4 GB";
    if (val < 8) return "8 GB";
    return "16 GB";
  }
  if (paramsLower.includes("m")) {
    const val = parseFloat(paramsLower);
    if (val < 100) return "512 MB";
    return "1 GB";
  }
  return "2 GB";
}

function renderModelPage(model) {
  const basePath = "../../../";
  
  let publisherLogoHTML = "";
  if (model.thumbnail && model.thumbnail.base64) {
    publisherLogoHTML = `<img src="data:${model.thumbnail.mimeType};base64,${model.thumbnail.base64}" class="publisher-avatar" alt="Publisher avatar">`;
  } else {
    const publisherName = model.modelId ? model.modelId.split("/")[0] : "LA Studio";
    const firstLetter = publisherName[0].toUpperCase();
    const colors = ["#2f9469", "#4b38cf", "#b7791f", "#1264c8", "#7c3aed", "#ec4899", "#f59e0b"];
    const colorIndex = firstLetter.charCodeAt(0) % colors.length;
    const avatarColor = colors[colorIndex];
    publisherLogoHTML = `<div class="publisher-avatar-letter" style="background-color: ${avatarColor}">${firstLetter}</div>`;
  }

  const downloads = model.stats?.displayDownloads || model.stats?.upstreamDownloads || 0;
  const likes = model.stats?.upstreamLikes || 0;
  const forks = Math.round(likes * 0.15);

  const cliCommand = `lastudio run -m ${model.modelId || model.id}`;

  const capsHTML = model.capabilities.map(cap => {
    const meta = CAPABILITY_META[cap] || { label: cap, className: "" };
    const colors = {
      tts: "color: var(--blue); background: #eaf2ff; border: 1px solid #8bbcff;",
      "voice-cloning": "color: var(--green); background: #e8f6ee; border: 1px solid #8bd3ad;",
      "voice-design": "color: var(--amber); background: #fff5df; border: 1px solid #ecc46e;",
      stt: "color: var(--violet); background: #efedff; border: 1px solid #b7adff;"
    };
    const style = colors[cap] || "color: var(--muted); background: var(--surface-strong); border: 1px solid var(--border);";
    return `<span class="cap-chip" style="${style}"><span class="icon ${meta.className}" style="border:none;background:none;width:auto;height:auto;display:inline;">${meta.label}</span> ${formatCapability(cap)}</span>`;
  }).join("");

  const runtimesText = model.runtimes.length ? model.runtimes.join(", ") : "Local / C++";
  const minMemory = estimateMinMemory(model);

  const variantOptionsHTML = model.files.map(file => {
    return `<option value="${file.file}">${file.file} (${file.size || "Required"})</option>`;
  }).join("");

  const filesTableRowsHTML = model.files.map(file => {
    const fileUrl = `https://huggingface.co/${model.modelId}/resolve/main/${file.file}`;
    return `
      <tr>
        <td><span class="files-table-name">${file.file}</span></td>
        <td><span class="files-table-size">${file.size || "Required"}</span></td>
        <td>
          <a class="files-table-action-btn" href="${fileUrl}" target="_blank" rel="noopener noreferrer">
            Download File
          </a>
        </td>
      </tr>
    `;
  }).join("");

  elements.pageLayout.innerHTML = `
    <div class="model-page-container">
      <div class="breadcrumb-row">
        <a href="${basePath}" class="back-link">
          <svg class="back-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          All Models
        </a>
      </div>

      <div class="model-header-row">
        <div class="model-header-left">
          <div class="publisher-logo-wrapper">
            ${publisherLogoHTML}
          </div>
          <div class="model-header-info">
            <div class="model-title-wrap">
              <h1 class="model-title-name">${model.title}</h1>
              <button class="copy-id-btn" title="Copy model ID">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
              <span class="badge badge-public">Public</span>
            </div>
            <p class="model-repo-id">${model.modelId || model.id}</p>
          </div>
        </div>
        <div class="model-header-right">
          <div class="action-buttons">
            <button class="action-btn fork-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
              Fork <span class="fork-count">${forks}</span>
            </button>
            <button class="action-btn star-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              Star <span class="star-count">${likes}</span>
            </button>
            <div class="use-btn-wrapper">
              <button class="use-model-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                Use Model in LA Studio
              </button>
              <div class="use-dropdown-menu" hidden>
                <div class="dropdown-header">Integration CLI Command</div>
                <div class="dropdown-code-box">
                  <code class="cli-cmd">${cliCommand}</code>
                  <button class="copy-cmd-btn" title="Copy command">Copy</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="model-tabs-row">
        <button class="tab-btn active" data-tab="model">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
          Model
        </button>
        <button class="tab-btn" data-tab="files">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          Files
        </button>
      </div>

      <div class="model-body-layout">
        <aside class="model-sidebar">
          <div class="sidebar-section">
            <h3>Description</h3>
            <p class="model-desc">${model.subtitle || model.description}</p>
          </div>

          <div class="sidebar-section">
            <h3>Stats</h3>
            <div class="stats-list">
              <div class="stat-row">
                <span class="stat-label">Downloads</span>
                <span class="stat-val downloads-val">${downloads.toLocaleString()}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Stars</span>
                <span class="stat-val stars-val">${likes.toLocaleString()}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Forks</span>
                <span class="stat-val forks-val">${forks.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div class="sidebar-section">
            <h3>Capabilities</h3>
            <div class="caps-tags-container">
              ${capsHTML}
            </div>
          </div>

          <div class="sidebar-section">
            <h3>Tech Specs</h3>
            <div class="tech-specs-list">
              <div class="spec-row">
                <span class="spec-label">Format</span>
                <span class="spec-val">GGUF</span>
              </div>
              <div class="spec-row">
                <span class="spec-label">Runtimes</span>
                <span class="spec-val runtimes-val">${runtimesText}</span>
              </div>
              <div class="spec-row">
                <span class="spec-label">Min Memory</span>
                <span class="spec-val mem-val">${minMemory}</span>
              </div>
            </div>
          </div>
        </aside>

        <div class="model-main-content">
          <section class="tab-pane active" id="pane-model">
            <div class="readme-box">
              <div class="readme-header">
                <div class="readme-header-left">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                  <span>README.md</span>
                </div>
                <div class="readme-header-right">
                  <div class="toggle-group">
                    <button class="toggle-btn active" id="btn-formatted">Formatted</button>
                    <button class="toggle-btn" id="btn-raw">Raw</button>
                  </div>
                </div>
              </div>
              <div class="readme-body">
                <div class="readme-markdown"></div>
                <pre class="readme-raw-text"></pre>
              </div>
            </div>
          </section>

          <section class="tab-pane" id="pane-files">
            <div class="download-section-box">
              <h2>Download Options</h2>
              <div class="download-selector-wrapper" style="margin-bottom:16px;">
                <select class="variant-select-page" style="width:100%; min-height:40px; border-radius:6px; border:1px solid var(--border); padding:0 12px; background:var(--surface); font-size:14px;">
                  ${variantOptionsHTML}
                </select>
              </div>
              <div class="download-action-row" style="display:flex; justify-content:space-between; align-items:center;">
                <span class="fit-indicator">✓ Likely Fit</span>
                <a class="download-action-btn-page" href="#" target="_blank" rel="noopener noreferrer" style="background:var(--violet); color:#fff; font-weight:700; padding:8px 20px; border-radius:6px; font-size:14px; display:inline-block; transition:opacity 0.2s;">
                  Download GGUF File
                </a>
              </div>
            </div>

            <div class="files-table-box">
              <h2>All Available Files</h2>
              <table class="files-table">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>File Size</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody class="files-table-body">
                  ${filesTableRowsHTML}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  const copyIdBtn = elements.pageLayout.querySelector(".copy-id-btn");
  copyIdBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(model.modelId || model.id);
    const originalHTML = copyIdBtn.innerHTML;
    copyIdBtn.innerHTML = "✓";
    setTimeout(() => {
      copyIdBtn.innerHTML = originalHTML;
    }, 1500);
  });

  const useBtn = elements.pageLayout.querySelector(".use-model-btn");
  const useDropdown = elements.pageLayout.querySelector(".use-dropdown-menu");
  useBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    useDropdown.hidden = !useDropdown.hidden;
  });
  
  document.addEventListener("click", () => {
    useDropdown.hidden = true;
  });
  useDropdown.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const copyCmdBtn = elements.pageLayout.querySelector(".copy-cmd-btn");
  copyCmdBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(cliCommand);
    const originalText = copyCmdBtn.textContent;
    copyCmdBtn.textContent = "Copied!";
    setTimeout(() => {
      copyCmdBtn.textContent = originalText;
    }, 1500);
  });

  const tabButtons = elements.pageLayout.querySelectorAll(".tab-btn");
  const panes = {
    model: elements.pageLayout.querySelector("#pane-model"),
    files: elements.pageLayout.querySelector("#pane-files")
  };
  
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const tabName = btn.getAttribute("data-tab");
      Object.keys(panes).forEach(k => {
        if (k === tabName) {
          panes[k].classList.add("active");
        } else {
          panes[k].classList.remove("active");
        }
      });
    });
  });

  const mdContainer = elements.pageLayout.querySelector(".readme-markdown");
  const rawContainer = elements.pageLayout.querySelector(".readme-raw-text");
  if (model.readme) {
    mdContainer.innerHTML = renderMarkdown(model.readme);
    rawContainer.textContent = model.readme;
  } else {
    mdContainer.textContent = "No README available for this model.";
    rawContainer.textContent = "No README available for this model.";
  }

  const btnFormatted = elements.pageLayout.querySelector("#btn-formatted");
  const btnRaw = elements.pageLayout.querySelector("#btn-raw");
  const readmeBody = elements.pageLayout.querySelector(".readme-body");

  btnFormatted.addEventListener("click", () => {
    btnFormatted.classList.add("active");
    btnRaw.classList.remove("active");
    readmeBody.classList.remove("raw-active");
  });

  btnRaw.addEventListener("click", () => {
    btnRaw.classList.add("active");
    btnFormatted.classList.remove("active");
    readmeBody.classList.add("raw-active");
  });

  const pageSelect = elements.pageLayout.querySelector(".variant-select-page");
  const pageDownloadBtn = elements.pageLayout.querySelector(".download-action-btn-page");

  const updatePageDownloadLink = () => {
    const selectedFile = pageSelect.value;
    if (model.modelId && selectedFile) {
      pageDownloadBtn.href = `https://huggingface.co/${model.modelId}/resolve/main/${selectedFile}`;
      pageDownloadBtn.style.pointerEvents = "auto";
      pageDownloadBtn.style.opacity = "1";
    } else {
      pageDownloadBtn.href = "#";
      pageDownloadBtn.style.pointerEvents = "none";
      pageDownloadBtn.style.opacity = "0.5";
    }
  };

  pageSelect.addEventListener("change", updatePageDownloadLink);
  updatePageDownloadLink();
}
