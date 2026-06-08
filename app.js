const CATALOG_URL = "./data/catalog.json";
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
  sort: "featured"
};

const elements = {
  list: document.querySelector("#model-list"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#result-count"),
  version: document.querySelector("#catalog-version"),
  search: document.querySelector("#model-search"),
  sort: document.querySelector("#sort-models"),
  capabilityInputs: document.querySelectorAll(".capability-filter input"),
  template: document.querySelector("#model-card-template")
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

  repoLink.href = model.modelId ? `https://huggingface.co/${model.modelId}` : "#";
  repoLink.textContent = model.modelId ? "Open on Hugging Face" : "Model details";
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
