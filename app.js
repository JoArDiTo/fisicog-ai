const STORAGE_KEY = "fisicog-gemini-api-key";
const MODEL_KEY = "fisicog-gemini-model";
const DEFAULT_MODEL = "gemini-4-hydrogen";
const MAX_FILE_BYTES = 14 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 14 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const publicAiApiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim() || "";
const usePublicAi =
  import.meta.env.VITE_USE_PUBLIC_AI_FLAG === "true" && Boolean(publicAiApiKey);
const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".csv", ".json", ".md", ".markdown", ".xml", ".yaml", ".yml",
  ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".php",
  ".rb", ".swift", ".kt", ".sql", ".sh", ".bash", ".toml", ".ini", ".log",
  ".r", ".ipynb", ".env", ".diff", ".patch", ".vue", ".svelte", ".dart",
  ".scala", ".ex", ".exs", ".hs", ".lua", ".pl", ".pm", ".ps1", ".bat",
  ".gradle", ".tf", ".proto", ".graphql", ".gql", ".rst", ".tex",
  ".properties", ".conf", ".cfg", ".lock", ".gitignore", ".dockerignore",
]);
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/yaml",
  "application/x-yaml",
]);
const SYSTEM_INSTRUCTION =
  "Eres FISICOG AI, un asistente útil, directo y resolutivo. Responde en el idioma del usuario con claridad, precisión y profundidad adecuadas a la consulta. Ayuda con ciencias, física, matemáticas, programación, historia, análisis, redacción y cualquier otro tema permitido. Estructura las respuestas cuando ayude a comprender. Si falta información importante, indícalo y pregunta lo necesario; no inventes hechos ni afirmes capacidades que no tienes.";

const elements = {
  workspace: document.querySelector(".workspace"),
  settingsPanel: document.querySelector(".settings-panel"),
  apiKey: document.querySelector("#api-key"),
  rememberKey: document.querySelector("#remember-key"),
  model: document.querySelector("#model-select"),
  modelControl: document.querySelector("#model-select").closest(".select-wrap"),
  settingsForm: document.querySelector("#settings-form"),
  settingsFeedback: document.querySelector("#settings-feedback"),
  connectionStatus: document.querySelector("#connection-status"),
  connectionLabel: document.querySelector("#connection-label"),
  activeModel: document.querySelector("#active-model"),
  messages: document.querySelector("#messages"),
  welcome: document.querySelector("#welcome-screen"),
  chatForm: document.querySelector("#chat-form"),
  messageInput: document.querySelector("#message-input"),
  sendButton: document.querySelector("#send-button"),
  clearChat: document.querySelector("#clear-chat"),
  chatPanel: document.querySelector("#chat-panel"),
  attachButton: document.querySelector("#attach-button"),
  fileInput: document.querySelector("#file-input"),
  attachmentPreviews: document.querySelector("#attachment-previews"),
  attachmentFeedback: document.querySelector("#attachment-feedback"),
  loadingLabel: document.querySelector("#loading-label"),
};

let apiKey = "";
let isBusy = false;
let conversation = [];
let pendingAttachments = [];
let shouldAutoScroll = true;
const retainedPreviewUrls = new Set();
let attachmentId = 0;
let attachmentFeedbackTimer;

function setConnection(state, label) {
  elements.connectionStatus.dataset.state = state;
  elements.connectionLabel.textContent = label;
}

function setFeedback(message, state = "success") {
  elements.settingsFeedback.textContent = message;
  elements.settingsFeedback.dataset.state = state;
}

function setModelBadge(model) {
  elements.activeModel.textContent = model.replaceAll("-", " ").toUpperCase();
}

function updateComposer() {
  elements.messageInput.disabled = !apiKey || isBusy;
  elements.sendButton.disabled =
    !apiKey || isBusy || (!elements.messageInput.value.trim() && pendingAttachments.length === 0);
  elements.attachButton.disabled = !apiKey || isBusy;
  elements.clearChat.disabled = isBusy;
  elements.loadingLabel.classList.toggle("visible", isBusy);
}

function scrollMessagesToBottom(force = false) {
  if (force) shouldAutoScroll = true;
  if (shouldAutoScroll) elements.messages.scrollTop = elements.messages.scrollHeight;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setAttachmentFeedback(message) {
  window.clearTimeout(attachmentFeedbackTimer);
  elements.attachmentFeedback.textContent = message;
  elements.attachmentFeedback.classList.toggle("visible", Boolean(message));
  if (message) {
    attachmentFeedbackTimer = window.setTimeout(() => {
      elements.attachmentFeedback.textContent = "";
      elements.attachmentFeedback.classList.remove("visible");
    }, 6500);
  }
}

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function getAttachmentType(file) {
  const extension = fileExtension(file.name);
  if (IMAGE_TYPES.has(extension)) return { kind: "image", mimeType: IMAGE_TYPES.get(extension) };
  if ([...IMAGE_TYPES.values()].includes(file.type)) return { kind: "image", mimeType: file.type };
  if (extension === ".pdf" || file.type === "application/pdf") {
    return { kind: "inline", mimeType: "application/pdf" };
  }

  if (
    TEXT_EXTENSIONS.has(extension) ||
    file.type.startsWith("text/") ||
    TEXT_MIME_TYPES.has(file.type)
  ) {
    return { kind: "text", mimeType: file.type || "text/plain" };
  }
  return null;
}

function createFileReaderResult(file, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`No se pudo leer el archivo “${file.name}”.`));
    reader.onabort = () => reject(new Error(`Se interrumpió la lectura de “${file.name}”.`));
    if (method === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

function renderAttachmentCard(attachment, removable) {
  const card = document.createElement("div");
  card.className = "attachment-card";
  if (removable) card.dataset.attachmentId = attachment.id;

  if (attachment.kind === "image" && attachment.previewUrl) {
    const image = document.createElement("img");
    image.src = attachment.previewUrl;
    image.alt = attachment.name;
    card.append(image);
  } else {
    const icon = document.createElement("span");
    icon.className = "attachment-file-icon";
    icon.textContent = (fileExtension(attachment.name).slice(1) || "FILE").slice(0, 5);
    card.append(icon);
  }

  const details = document.createElement("span");
  details.className = "attachment-details";
  const name = document.createElement("span");
  name.className = "attachment-name";
  name.textContent = attachment.name;
  name.title = attachment.name;
  const size = document.createElement("span");
  size.className = "attachment-size";
  size.textContent = formatFileSize(attachment.size);
  details.append(name, size);
  card.append(details);

  if (removable) {
    const remove = document.createElement("button");
    remove.className = "remove-attachment";
    remove.type = "button";
    remove.dataset.removeAttachment = attachment.id;
    remove.setAttribute("aria-label", `Quitar ${attachment.name}`);
    remove.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    card.append(remove);
  }
  return card;
}

function renderPendingAttachments() {
  elements.attachmentPreviews.replaceChildren(
    ...pendingAttachments.map((attachment) => renderAttachmentCard(attachment, true)),
  );
  updateComposer();
}

function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const errors = [];

  for (const file of files) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      errors.push(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos por mensaje.`);
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`“${file.name}” supera el límite de ${formatFileSize(MAX_FILE_BYTES)}.`);
      continue;
    }
    if (pendingAttachments.reduce((total, item) => total + item.size, 0) + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      errors.push(`El tamaño total de los adjuntos no puede superar ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)}.`);
      continue;
    }
    const type = getAttachmentType(file);
    if (!type) {
      errors.push(`“${file.name}” no es compatible. Adjunta imágenes, PDF o archivos de texto/código.`);
      continue;
    }

    pendingAttachments.push({
      id: `attachment-${++attachmentId}`,
      file,
      name: file.name || `imagen-${attachmentId}.${type.mimeType.split("/")[1]}`,
      size: file.size,
      ...type,
      previewUrl: type.kind === "image" ? URL.createObjectURL(file) : "",
    });
  }

  renderPendingAttachments();
  setAttachmentFeedback(errors.join(" "));
}

function clearPendingAttachments({ revoke = true } = {}) {
  if (revoke) {
    pendingAttachments.forEach((attachment) => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
  }
  pendingAttachments = [];
  renderPendingAttachments();
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function inlineMarkdown(text) {
  const codeSegments = [];
  let safe = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@INLINE${codeSegments.length}@@`;
    codeSegments.push(`<code>${code}</code>`);
    return token;
  });
  safe = safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
  return safe.replace(/@@INLINE(\d+)@@/g, (_match, index) => codeSegments[Number(index)]);
}

function protectMath(markdown) {
  const expressions = [];
  const segments = markdown.split(/(^```[^\n]*\n[\s\S]*?^```[^\n]*$)/gm);
  const protectedMarkdown = segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /(?<!\\)\$\$([\s\S]+?)\$\$|(?<!\\)\$([^\n$]+?)\$(?!\$)/g,
        (match, displayExpression, inlineExpression) => {
          const token = `FISICOGMATH${expressions.length}TOKEN`;
          expressions.push({
            token,
            source: match,
            display: displayExpression !== undefined,
          });
          return token;
        },
      );
    })
    .join("");
  return { markdown: protectedMarkdown, expressions };
}

function renderMath(element) {
  if (typeof renderMathInElement !== "function") return;
  renderMathInElement(element, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
  });
}

function renderMarkdown(markdown) {
  const protectedMath = protectMath(markdown.replace(/\r\n/g, "\n"));
  const lines = protectedMath.markdown.split("\n");
  const output = [];
  let paragraph = [];
  let listType = "";
  let codeLines = null;
  let codeLanguage = "";

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = "";
    }
  };
  const openList = (type) => {
    if (listType !== type) {
      closeList();
      output.push(`<${type}>`);
      listType = type;
    }
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (codeLines === null) {
        flushParagraph();
        closeList();
        codeLines = [];
        codeLanguage = fence[1].trim();
      } else {
        const code = escapeHtml(codeLines.join("\n"));
        const language = escapeHtml(codeLanguage || "código");
        output.push(
          `<div class="code-block"><div class="code-header"><span>${language}</span><button class="copy-button" type="button" data-copy="${encodeURIComponent(codeLines.join("\n"))}"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.3" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7" stroke="currentColor" stroke-width="1.2"/></svg>Copiar</button></div><pre><code>${code}</code></pre></div>`,
        );
        codeLines = null;
        codeLanguage = "";
      }
      continue;
    }

    if (codeLines !== null) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const unorderedItem = line.match(/^\s*[-*+]\s+(.+)$/);
    const orderedItem = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);

    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (unorderedItem || orderedItem) {
      flushParagraph();
      openList(unorderedItem ? "ul" : "ol");
      output.push(`<li>${inlineMarkdown((unorderedItem || orderedItem)[1])}</li>`);
    } else if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(line);
    }
  }

  if (codeLines !== null) {
    output.push(`<div class="code-block"><div class="code-header"><span>${escapeHtml(codeLanguage || "código")}</span></div><pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`);
  }
  flushParagraph();
  closeList();
  return output.join("").replace(/FISICOGMATH(\d+)TOKEN/g, (_match, index) => {
    const expression = protectedMath.expressions[Number(index)];
    return `<span class="math-source">${escapeHtml(expression.source)}</span>`;
  });
}

function updateAssistantMessage(row, text, streaming) {
  const content = row.querySelector(".message-text");
  content.innerHTML = renderMarkdown(text);
  renderMath(content);
  row.classList.toggle("is-streaming", streaming);

  row.querySelector(".stream-cursor")?.remove();
  row.querySelector(".response-actions")?.remove();
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    cursor.setAttribute("aria-label", "Generando respuesta");
    content.append(cursor);
  } else {
    const actions = document.createElement("div");
    actions.className = "response-actions";
    const copy = document.createElement("button");
    copy.className = "copy-response";
    copy.type = "button";
    copy.dataset.copy = encodeURIComponent(text);
    copy.textContent = "Copiar respuesta";
    actions.append(copy);
    if (row.dataset.conversationIndex !== undefined) {
      const regenerate = document.createElement("button");
      regenerate.className = "regenerate-response";
      regenerate.type = "button";
      regenerate.dataset.regenerate = "";
      regenerate.setAttribute("aria-label", "Volver a generar respuesta");
      regenerate.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.2 7.1a5.3 5.3 0 0 0-9.6-2L2.5 7M2.5 3.8V7h3.2M2.8 8.9a5.3 5.3 0 0 0 9.6 2l1.1-1.9M13.5 12.2V9H10.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>Volver a generar';
      actions.append(regenerate);
    }
    row.querySelector(".message-content").append(actions);
  }
}

function addMessage(role, text, { isError = false, attachments = [], streaming = false } = {}) {
  elements.welcome.hidden = true;
  const row = document.createElement("article");
  row.className = `message-row ${role}`;
  if (role === "user") row.dataset.prompt = text;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "TÚ" : "F";

  const body = document.createElement("div");
  body.className = `message-content${isError ? " error-message" : ""}`;
  const heading = document.createElement("div");
  heading.className = "message-heading";
  heading.textContent = role === "user" ? "Tú" : "FISICOG AI";
  const content = document.createElement("div");
  content.className = "message-text";
  const isAssistantResponse = role === "assistant" && !isError;
  if (!isAssistantResponse) {
    content.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
  }
  body.append(heading, content);

  if (role === "user" && attachments.length) {
    const attachmentList = document.createElement("div");
    attachmentList.className = "message-attachments";
    attachments.forEach((attachment) => {
      if (attachment.kind === "image" && attachment.previewUrl) {
        const wrapper = document.createElement("div");
        wrapper.className = "message-image-attachment";
        const image = document.createElement("img");
        image.className = "attachment-image";
        image.src = attachment.previewUrl;
        image.alt = attachment.name;
        const caption = document.createElement("span");
        caption.className = "attachment-name";
        caption.textContent = attachment.name;
        wrapper.append(image, caption);
        attachmentList.append(wrapper);
      } else {
        attachmentList.append(renderAttachmentCard(attachment, false));
      }
      if (attachment.previewUrl) retainedPreviewUrls.add(attachment.previewUrl);
    });
    body.append(attachmentList);
  }

  row.append(avatar, body);
  elements.messages.append(row);
  if (isAssistantResponse) updateAssistantMessage(row, text, streaming);
  scrollMessagesToBottom();
  return row;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copiado";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1400);
  } catch {
    setFeedback("No se pudo copiar. Revisa los permisos del navegador.", "error");
  }
}

async function createGeminiAttachmentPart(attachment) {
  if (attachment.kind === "text") {
    const text = await createFileReaderResult(attachment.file, "text");
    return {
      text: `Contenido del archivo adjunto "${attachment.name}":\n${text}\n[Fin del archivo adjunto "${attachment.name}"]`,
    };
  }

  const dataUrl = await createFileReaderResult(attachment.file, "data-url");
  if (typeof dataUrl !== "string" || !dataUrl.includes(",")) {
    throw new Error(`No se pudo convertir “${attachment.name}” para enviarlo a Gemini.`);
  }
  return {
    inlineData: {
      mimeType: attachment.mimeType,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
    },
  };
}

function getResponseText(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Gemini devolvió un fragmento de respuesta inválido.");
  }
  if (data.error) throw new Error(data.error.message || "Gemini devolvió un error.");
  return data.candidates?.[0]?.content?.parts
    ?.filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("") || "";
}

async function consumeGeminiStream(response, onText) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const data = await response.json();
    const answer = getResponseText(data);
    if (answer) onText(answer);
    return answer.trim();
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  const consumeEvent = (event) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error("Gemini envió un fragmento de respuesta inválido.");
    }
    const fragment = getResponseText(payload);
    if (!fragment) return;
    answer += fragment;
    onText(answer);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    events.forEach(consumeEvent);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer);
  return answer.trim();
}

async function sendMessage(text, { regenerate = false } = {}) {
  if ((!text.trim() && !regenerate && pendingAttachments.length === 0) || !apiKey || isBusy) return;
  const attachments = regenerate ? [] : [...pendingAttachments];
  const prompt = text.trim() || "Analiza los archivos adjuntos y describe su contenido relevante.";
  isBusy = true;
  updateComposer();
  setConnection("ready", "Consultando Gemini…");

  let attachmentParts;
  try {
    attachmentParts = regenerate
      ? []
      : await Promise.all(attachments.map(createGeminiAttachmentPart));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron leer los archivos adjuntos.";
    setAttachmentFeedback(message);
    setConnection("ready", "API Key configurada");
    isBusy = false;
    updateComposer();
    return;
  }

  if (!regenerate) {
    elements.messageInput.value = "";
    elements.messageInput.style.height = "auto";
    clearPendingAttachments({ revoke: false });
    scrollMessagesToBottom(true);
    addMessage("user", prompt, { attachments });
    conversation.push({ role: "user", parts: [{ text: prompt }, ...attachmentParts] });
  }

  let assistantRow = null;
  let streamedText = "";
  let renderFrame = 0;
  try {
    const model = elements.model.value;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: conversation,
        }),
      },
    );

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message = data?.error?.message || `La API respondió con el estado ${response.status}.`;
      throw new Error(message);
    }

    assistantRow = addMessage("assistant", "", { streaming: true });
    const answer = await consumeGeminiStream(response, (textSoFar) => {
      streamedText = textSoFar;
      if (renderFrame) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = 0;
        updateAssistantMessage(assistantRow, streamedText, true);
        scrollMessagesToBottom();
      });
    });
    if (!answer) {
      assistantRow.remove();
      assistantRow = null;
      throw new Error("Gemini devolvió una respuesta vacía. Inténtalo de nuevo.");
    }

    streamedText = answer;
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    conversation.push({ role: "model", parts: [{ text: answer }] });
    assistantRow.dataset.conversationIndex = String(conversation.length - 1);
    updateAssistantMessage(assistantRow, answer, false);
    scrollMessagesToBottom();
    setConnection("ready", "Conectado a Gemini");
  } catch (error) {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    if (!regenerate) conversation.pop();
    if (assistantRow) {
      if (streamedText.trim()) updateAssistantMessage(assistantRow, streamedText, false);
      else assistantRow.remove();
    }
    const message = error instanceof Error ? error.message : "Error inesperado al contactar Gemini.";
    addMessage("assistant", `No se pudo generar la respuesta: ${message}`, { isError: true });
    setConnection("error", "Error de conexión");
  } finally {
    isBusy = false;
    updateComposer();
    elements.messageInput.focus();
  }
}

elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const enteredKey = elements.apiKey.value.trim();
  if (!enteredKey) {
    setFeedback("Pega tu API Key de Gemini para continuar.", "error");
    elements.apiKey.focus();
    return;
  }

  apiKey = enteredKey;
  let storageAvailable = true;
  try {
    if (elements.rememberKey.checked) {
      localStorage.setItem(STORAGE_KEY, apiKey);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(MODEL_KEY, elements.model.value);
  } catch {
    storageAvailable = false;
  }
  setModelBadge(elements.model.value);
  setConnection("ready", "API Key configurada");
  setFeedback(
    storageAvailable
      ? elements.rememberKey.checked
        ? "Clave aplicada y guardada en este navegador."
        : "Clave aplicada para esta sesión."
      : "Clave aplicada, pero el navegador no permitió guardar la configuración.",
    storageAvailable ? "success" : "error",
  );
  updateComposer();
});

elements.model.addEventListener("change", () => {
  setModelBadge(elements.model.value);
  try {
    localStorage.setItem(MODEL_KEY, elements.model.value);
  } catch {
    setFeedback("No se pudo guardar el modelo; se usará mientras esta página permanezca abierta.", "error");
  }
});

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(elements.messageInput.value);
});

elements.messageInput.addEventListener("input", () => {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 140)}px`;
  updateComposer();
});

elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!elements.sendButton.disabled) sendMessage(elements.messageInput.value);
  }
});

document.querySelector("#toggle-key").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const showing = elements.apiKey.type === "text";
  elements.apiKey.type = showing ? "password" : "text";
  button.setAttribute("aria-label", showing ? "Mostrar API Key" : "Ocultar API Key");
});

document.querySelector("#clear-chat").addEventListener("click", () => {
  if (isBusy) return;
  conversation = [];
  elements.messages.querySelectorAll(".message-row").forEach((message) => message.remove());
  retainedPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  retainedPreviewUrls.clear();
  clearPendingAttachments();
  elements.welcome.hidden = false;
  shouldAutoScroll = true;
  elements.messages.scrollTop = 0;
});

elements.attachButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => {
  addFiles(elements.fileInput.files);
  elements.fileInput.value = "";
});

elements.attachmentPreviews.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-attachment]");
  if (!removeButton) return;
  const [removed] = pendingAttachments.filter((attachment) => attachment.id === removeButton.dataset.removeAttachment);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== removeButton.dataset.removeAttachment);
  renderPendingAttachments();
  setAttachmentFeedback("");
});

elements.chatPanel.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  elements.chatForm.classList.add("drag-over");
});
elements.chatPanel.addEventListener("dragover", (event) => {
  if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = apiKey && !isBusy ? "copy" : "none";
  elements.chatForm.classList.add("drag-over");
});
elements.chatPanel.addEventListener("dragleave", (event) => {
  if (!elements.chatPanel.contains(event.relatedTarget)) elements.chatForm.classList.remove("drag-over");
});
elements.chatPanel.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  elements.chatForm.classList.remove("drag-over");
  if (!apiKey) {
    setAttachmentFeedback("Aplica tu API Key antes de adjuntar archivos.");
    return;
  }
  if (isBusy) return;
  addFiles(event.dataTransfer.files);
});

elements.messageInput.addEventListener("paste", (event) => {
  const imageFiles = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!imageFiles.length) return;
  event.preventDefault();
  if (!apiKey) {
    setAttachmentFeedback("Aplica tu API Key antes de pegar imágenes.");
    return;
  }
  addFiles(imageFiles);
});

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    if (!apiKey) {
      setFeedback("Primero aplica tu API Key para iniciar el chat.", "error");
      elements.apiKey.focus();
      return;
    }
    sendMessage(button.dataset.prompt);
  });
});

elements.messages.addEventListener("click", (event) => {
  const regenerateButton = event.target.closest("button[data-regenerate]");
  if (regenerateButton) {
    if (isBusy || !apiKey) return;
    const assistantRow = regenerateButton.closest(".message-row.assistant");
    const userRow = assistantRow?.previousElementSibling;
    const modelIndex = Number(assistantRow?.dataset.conversationIndex);
    if (
      !assistantRow ||
      !userRow?.classList.contains("user") ||
      !Number.isInteger(modelIndex) ||
      conversation[modelIndex]?.role !== "model" ||
      conversation[modelIndex - 1]?.role !== "user"
    ) {
      return;
    }

    const prompt = userRow.dataset.prompt;
    if (!prompt) return;
    conversation.splice(modelIndex);
    while (userRow.nextElementSibling) userRow.nextElementSibling.remove();
    sendMessage(prompt, { regenerate: true });
    return;
  }

  const button = event.target.closest("button[data-copy]");
  if (!button) return;
  copyText(decodeURIComponent(button.dataset.copy), button);
});

elements.messages.addEventListener("scroll", () => {
  const distanceToBottom =
    elements.messages.scrollHeight - elements.messages.clientHeight - elements.messages.scrollTop;
  shouldAutoScroll = distanceToBottom < 72;
});
elements.messages.addEventListener(
  "wheel",
  (event) => {
    if (event.deltaY < 0) shouldAutoScroll = false;
  },
  { passive: true },
);

let lastTouchY = 0;
elements.messages.addEventListener(
  "touchstart",
  (event) => {
    lastTouchY = event.touches[0]?.clientY || 0;
  },
  { passive: true },
);
elements.messages.addEventListener(
  "touchmove",
  (event) => {
    const touchY = event.touches[0]?.clientY || 0;
    if (touchY > lastTouchY) shouldAutoScroll = false;
    lastTouchY = touchY;
  },
  { passive: true },
);

let savedModel = null;
let savedKey = null;
try {
  savedModel = localStorage.getItem(MODEL_KEY);
  savedKey = localStorage.getItem(STORAGE_KEY);
} catch {
  setFeedback("El navegador bloqueó el almacenamiento local; puedes aplicar una clave para esta sesión.", "error");
}
if (savedModel && [...elements.model.options].some((option) => option.value === savedModel)) {
  elements.model.value = savedModel;
} else {
  elements.model.value = DEFAULT_MODEL;
}
setModelBadge(elements.model.value);

if (usePublicAi) {
  apiKey = publicAiApiKey;
  elements.model.setAttribute("aria-label", "Modelo de Gemini");
  elements.activeModel.hidden = true;
  elements.activeModel.after(elements.modelControl);
  elements.modelControl.classList.add("public-model-control");
  elements.settingsPanel.style.display = "none";
  elements.workspace.style.gridTemplateColumns = "minmax(0, 1fr)";
  setConnection("ready", "IA pública configurada");
} else if (savedKey) {
  elements.apiKey.value = savedKey;
  apiKey = savedKey;
  setConnection("ready", "API Key configurada");
  setFeedback("Clave cargada desde este navegador.");
}
updateComposer();
