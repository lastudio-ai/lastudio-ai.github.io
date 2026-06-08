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
  detailTemplate: document.querySelector("#model-detail-template")
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
      e.preventDefault();
    }
    selectModel(model.modelId || model.id);
  });

  repoLink.href = `#/models/${model.modelId || model.id}`;
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
