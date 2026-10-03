(() => {
  "use strict";

  const HOST_ID = "conversation-navigator-extension";
  const VERSION = "0.1.5";
  if (document.getElementById(HOST_ID)) return;
  // Install before the page's delegated handlers. Only events from our own
  // shadow buttons are consumed; ordinary page interaction passes through.
  let forwardNavigationEvent = () => {};
  for (const type of ["pointerdown", "pointerup", "pointercancel", "click", "keydown"]) {
    window.addEventListener(type, event => forwardNavigationEvent(event), true);
  }

  function start() {
  const MESSAGE_SELECTOR = [
    '[data-message-author-role="user"]', '[data-message-author-role="assistant"]',
    '[data-conversation-role="user"]', '[data-conversation-role="assistant"]',
    '[data-turn="user"]', '[data-turn="assistant"]', '[data-user-message-bubble]',
    '[data-chatgpt-search-unit-key$=":user"]', '[data-chatgpt-search-unit-key$=":assistant"]',
    '[data-chatgpt-agent-turn-start]'
  ].join(",");
  const THREAD_SELECTOR = "#thread, [data-testid='thread'], [data-testid='conversation-thread'], [data-conversation-transcript]";
  const TURN_SELECTOR = "[data-turn-id], [data-turn-key], [data-testid^='conversation-turn-'], article[data-turn], section[data-turn]";

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Keep the page's styles, event handlers and DOM observer away from our UI.
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("pointer-events", "none", "important");
  host.style.setProperty("z-index", "2147483646", "important");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { color-scheme: light; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .navigator {
      --ink: #343840; --muted: #858993; --line: #b9bdc7;
      --accent: #6873ed; --surface: #fff; --border: #e9eaf0;
      --shadow: 0 12px 38px #19203c16, 0 2px 8px #19203c0a;
      position: fixed; right: 14px; top: 50%; transform: translateY(-50%);
      width: 42px; max-height: calc(100dvh - 180px); padding: 10px 2px;
      display: flex; flex-direction: column; align-items: center; gap: 7px;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink); pointer-events: auto;
    }
    .navigator[data-theme="dark"] {
      color-scheme: dark; --ink: #ededf4; --muted: #a0a0ad;
      --line: #696974; --accent: #a2a9ff; --surface: #25252c;
      --border: #3d3d48; --shadow: 0 12px 38px #0005, 0 2px 8px #0003;
    }
    .count {
      min-width: 24px; padding: 3px 5px; border-radius: 7px;
      color: var(--muted); text-align: center; font-size: 10px;
      font-weight: 600; font-variant-numeric: tabular-nums;
      user-select: none; cursor: default;
    }
    .list {
      position: relative; width: 38px; min-height: 0; overflow-y: auto; overflow-x: hidden;
      overscroll-behavior: contain; scrollbar-width: none;
      display: flex; flex-direction: column; align-items: center;
    }
    .list::-webkit-scrollbar { display: none; }
    .mark {
      appearance: none; display: grid; place-items: center; flex-shrink: 0;
      width: 36px; height: 22px; padding: 0; border: 0;
      border-radius: 6px; background: transparent; color: var(--line);
      cursor: pointer; outline: none; touch-action: manipulation;
    }
    .mark::after {
      content: ""; width: 17px; height: 3px; border-radius: 10px;
      background: currentColor; transition: width 140ms, color 140ms;
    }
    .mark:hover, .mark:focus-visible { color: var(--accent); }
    .mark:hover::after, .mark:focus-visible::after { width: 27px; }
    .mark:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .mark[aria-current="true"] { color: var(--accent); }
    .mark[aria-current="true"]::after { width: 27px; height: 4px; }
    .preview {
      position: fixed; right: 66px; width: min(330px, calc(100vw - 88px));
      max-height: min(380px, calc(100dvh - 32px)); overflow-y: auto;
      padding: 16px 18px; background: var(--surface); color: var(--ink);
      border: 1px solid var(--border); border-radius: 14px;
      box-shadow: var(--shadow); pointer-events: auto;
      overflow-wrap: anywhere; white-space: normal;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .preview-label {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; margin-bottom: 9px; color: var(--muted);
      font-size: 10px; letter-spacing: .04em;
    }
    .preview-index { color: var(--accent); font-weight: 650; }
    .preview-text { font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
    .preview-hint {
      margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border);
      font-size: 10px; color: var(--muted);
    }
    @media (max-width: 600px) {
      .navigator { right: 4px; width: 32px; }
      .list { width: 32px; } .mark { width: 30px; }
      .preview { right: 44px; width: calc(100vw - 60px); }
    }
    @media (prefers-reduced-motion: reduce) { .mark::after { transition: none; } }
  `;
  shadow.append(style);

  const nav = document.createElement("nav");
  nav.className = "navigator";
  nav.setAttribute("aria-label", "对话问题导航");
  nav.hidden = true;
  const count = document.createElement("div");
  count.className = "count";
  const list = document.createElement("div");
  list.className = "list";
  const preview = document.createElement("div");
  preview.className = "preview";
  preview.id = "conversation-navigator-preview";
  preview.setAttribute("role", "tooltip");
  preview.hidden = true;
  const previewLabel = document.createElement("div");
  previewLabel.className = "preview-label";
  const previewIndex = document.createElement("span");
  previewIndex.className = "preview-index";
  const previewTitle = document.createElement("span");
  previewTitle.textContent = "你的提问";
  previewLabel.append(previewIndex, previewTitle);
  const previewText = document.createElement("div");
  previewText.className = "preview-text";
  const previewHint = document.createElement("div");
  previewHint.className = "preview-hint";
  preview.append(previewLabel, previewText, previewHint);
  // The preview is a sibling: a fixed child of a transformed nav would use
  // the rail as its containing block instead of the viewport.
  shadow.append(nav, preview);
  nav.append(count, list);
  document.documentElement.append(host);

  let entries = [];
  let activeIndex = -1;
  let previewedIndex = -1;
  let hideTimer = 0;
  let refreshTimer = 0;
  let frame = 0;
  let scrollContainer = null;
  let currentPath = location.pathname;
  let jumpToken = 0;
  let lastJump = null;
  let clickCount = 0;
  let pendingJumpCleanup = null;
  let pointerSelection = null;
  let threadRoot = null;
  let nextNodeId = 0;
  const nodeIds = new WeakMap();
  const promptText = new Map();
  const knownEntries = new Map();

  function messageRole(element) {
    for (const attribute of ["data-message-author-role", "data-conversation-role", "data-turn"]) {
      const role = element.getAttribute(attribute);
      if (role === "user" || role === "assistant") return role;
    }
    const searchKey = element.getAttribute("data-chatgpt-search-unit-key") || "";
    if (element.hasAttribute("data-user-message-bubble") || searchKey.endsWith(":user")) return "user";
    if (element.hasAttribute("data-chatgpt-agent-turn-start") || searchKey.endsWith(":assistant")) return "assistant";
    return null;
  }

  function excluded(element) {
    return !!element.closest("aside, nav, [role='navigation'], [contenteditable='true'], [hidden], [aria-hidden='true'], [inert]");
  }

  function findThreadRoot() {
    const roots = [...document.querySelectorAll(THREAD_SELECTOR)].filter(root => !excluded(root));
    const populated = roots.find(root => root.querySelector(MESSAGE_SELECTOR));
    if (populated) return populated;
    const main = [...document.querySelectorAll("main, [role='main']")]
      .find(root => !excluded(root) && root.querySelector(MESSAGE_SELECTOR));
    if (main) return main;
    if (roots.length) return roots[0];
    // For an unlabelled layout, discover the smallest shared message parent.
    // Never use the whole body as a scraping fallback.
    const messages = [...document.querySelectorAll(MESSAGE_SELECTOR)].filter(node => !excluded(node));
    let parent = messages[0]?.parentElement;
    while (parent && !messages.every(node => parent.contains(node))) parent = parent.parentElement;
    return parent && parent !== document.body && parent !== document.documentElement ? parent : null;
  }

  function turnContainer(message, role) {
    for (let node = message; node && node !== threadRoot; node = node.parentElement) {
      if (!node.matches(TURN_SELECTOR)) continue;
      const declared = messageRole(node);
      if (declared === role) return node;
      const opposite = [...node.querySelectorAll(MESSAGE_SELECTOR)]
        .some(child => messageRole(child) && messageRole(child) !== role);
      if (!opposite) return node;
    }
    return message;
  }

  function identityFor(message, role) {
    for (const attribute of ["data-turn-id", "data-message-id", "data-chatgpt-search-unit-key", "data-turn-key", "data-testid"]) {
      const node = message.closest(`[${attribute}]`);
      const value = node?.getAttribute(attribute);
      if (!value || (attribute === "data-testid" && !value.startsWith("conversation-turn-"))) continue;
      return { key: `${attribute}:${value}:${role}`, attribute, value, role, ref: node };
    }
    if (!nodeIds.has(message)) nodeIds.set(message, ++nextNodeId);
    return { key: `node:${nodeIds.get(message)}:${role}`, role, ref: message };
  }

  function messageText(message) {
    const content = message.querySelector("[data-user-message-bubble]")
      || message.querySelector(".whitespace-pre-wrap, [data-message-content], [data-composer-markdown]")
      || message;
    const clone = content.cloneNode(true);
    clone.querySelectorAll("button, [role='button'], textarea, .sr-only, [aria-hidden='true']")
      .forEach(control => control.remove());
    clone.querySelectorAll("br").forEach(lineBreak => lineBreak.replaceWith("\n"));
    clone.querySelectorAll("p, li, pre").forEach(block => block.append("\n"));
    return (clone.textContent || "").replace(/\u200b/g, "").trim().replace(/\n{3,}/g, "\n\n");
  }

  function collectEntries() {
    const scope = threadRoot = findThreadRoot();
    if (!scope) return [];
    const messages = [...scope.querySelectorAll(MESSAGE_SELECTOR)].filter(message => {
      if (excluded(message)) return false;
      const ancestor = message.parentElement?.closest(MESSAGE_SELECTOR);
      return !ancestor || messageRole(ancestor) !== messageRole(message);
    });
    const feed = messages.map(node => ({ node, role: messageRole(node), cached: null }));
    const freshUserKeys = new Set(messages.filter(node => messageRole(node) === "user")
      .map(node => identityFor(node, "user").key));
    // Insert persistent user shells BEFORE associating answers. Otherwise an
    // unmounted user could let its answer attach to the preceding question.
    for (const [key, cached] of knownEntries) {
      if (freshUserKeys.has(key)) continue;
      const question = resolveIdentity(cached.identity);
      if (question?.anchor) feed.push({ node: question.anchor, role: "user", cached });
    }
    feed.sort((left, right) => {
      const position = left.node.compareDocumentPosition(right.node);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1
        : position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
    });
    const collected = [];
    for (const { node: message, role, cached } of feed) {
      if (role === "user") {
        const identity = cached?.identity || identityFor(message, role);
        const text = cached?.text || messageText(message);
        if (text) promptText.set(identity.key, text);
        const previous = cached || knownEntries.get(identity.key);
        collected.push({ key: identity.key, identity,
          question: cached ? message : turnContainer(message, role), answer: null,
          answerIdentity: previous?.answerIdentity || null,
          text: text || promptText.get(identity.key) || "附件 / 图片提问" });
      } else if (role === "assistant" && collected.length) {
        const latest = collected[collected.length - 1];
        const responseGroup = message.closest("[data-turn-key]")?.getAttribute("data-turn-key");
        const questionGroup = latest.question.closest("[data-turn-key]")?.getAttribute("data-turn-key");
        if (responseGroup && questionGroup && responseGroup !== questionGroup) continue;
        if (!latest.answer) {
          latest.answer = turnContainer(message, role);
          latest.answerIdentity = identityFor(message, role);
        }
      }
    }
    for (const entry of collected) {
      if (!entry.answer && entry.answerIdentity) entry.answer = resolveIdentity(entry.answerIdentity)?.anchor || null;
      knownEntries.set(entry.key, { ...entry });
    }
    return collected;
  }

  function scrollAnchor(message) {
    if (!message?.isConnected) return null;
    const hasBox = element => {
      if (!element || element.closest("[hidden], [aria-hidden='true']")) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    if (hasBox(message)) return message;
    // Role attributes can live on display:contents wrappers or empty markers.
    // Those have no usable bounding box: aim at rendered message content.
    for (const candidate of message.querySelectorAll(
      ".markdown, [data-markdown-text-style='assistant-message'], [data-message-content], p, div, pre"
    )) {
      if (hasBox(candidate)) return candidate;
    }
    if (message.hasAttribute("data-chatgpt-agent-turn-start")) {
      const container = message.closest("[data-conversation-role='assistant'], [data-chatgpt-search-unit-key$=':assistant']");
      const content = container?.querySelector(".markdown, [data-markdown-text-style='assistant-message']")
        || message.nextElementSibling;
      if (hasBox(content)) return content;
    }
    // A persistent turn shell can still be navigated to while its message
    // contents are temporarily unmounted. The jump settles after remounting.
    const shell = message.closest("[data-turn-key], [data-testid^='conversation-turn-']");
    return shell?.getClientRects().length ? shell : message;
  }

  function resolveIdentity(identity) {
    if (!identity || !threadRoot) return null;
    let shell = identity.ref;
    if (identity.attribute) {
      const selector = `[${identity.attribute}="${CSS.escape(identity.value)}"]`;
      shell = threadRoot.matches(selector) ? threadRoot
        : [...threadRoot.querySelectorAll(selector)].find(node => !excluded(node));
    }
    if (!shell?.isConnected || !threadRoot.contains(shell) || excluded(shell)) return null;
    const message = messageRole(shell) === identity.role ? shell
      : [...shell.querySelectorAll(MESSAGE_SELECTOR)].find(node => messageRole(node) === identity.role && !excluded(node));
    const turn = message ? turnContainer(message, identity.role) : shell;
    const anchor = scrollAnchor(turn);
    const hasContent = message && (messageText(message) || message.querySelector("img, video, audio, canvas"));
    const rect = anchor?.getBoundingClientRect();
    return { anchor, ready: !!(hasContent && rect?.width > 0 && rect.height > 0) };
  }

  function findScrollContainer(element) {
    // Start outside the turn, so a clipped bubble/code block isn't mistaken
    // for the conversation viewport. Prefer normal scrollers over clip boxes.
    const turn = element?.closest(TURN_SELECTOR) || element?.closest(MESSAGE_SELECTOR) || element;
    const candidates = [];
    for (let parent = turn?.parentElement;
      parent && parent !== document.body && parent !== document.documentElement;
      parent = parent.parentElement) {
      if (parent.clientHeight > 0 && parent.scrollHeight > parent.clientHeight + 1) candidates.push(parent);
    }
    const normal = candidates.find(node => /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY));
    if (normal) return normal;
    const known = candidates.find(node => node.matches("main, #main, #thread, [data-swipe-scroll-container], [data-testid='mobile-app-shell-scroll-container']")
      && getComputedStyle(node).overflowY !== "clip");
    if (known) return known;
    const hidden = candidates.find(node => getComputedStyle(node).overflowY === "hidden");
    if (hidden) return hidden;
    return document.scrollingElement || document.documentElement;
  }

  function viewportBounds(container = scrollContainer) {
    if (!container || container === document.scrollingElement) {
      return { top: 0, bottom: window.innerHeight };
    }
    const rect = container.getBoundingClientRect();
    const top = rect.top + container.clientTop;
    return { top: Math.max(0, top), bottom: Math.min(innerHeight, top + container.clientHeight) };
  }

  function scrollRange(container) {
    const extent = Math.max(0, container.scrollHeight - container.clientHeight);
    const style = getComputedStyle(container);
    const reverse = (style.display.includes("flex") && style.flexDirection === "column-reverse")
      || container.scrollTop < -1;
    return { minimum: reverse ? -extent : 0, maximum: reverse ? 0 : extent, reverse };
  }

  function topOffset(container) {
    const bounds = viewportBounds(container);
    let coveredUntil = bounds.top;
    for (const header of document.querySelectorAll("#page-header, [data-testid='top-bar'], header")) {
      const position = getComputedStyle(header).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const rect = header.getBoundingClientRect();
      if (rect.width > 0 && rect.top <= bounds.top + 2 && rect.bottom > bounds.top
        && rect.bottom < bounds.top + (bounds.bottom - bounds.top) / 2) {
        coveredUntil = Math.max(coveredUntil, rect.bottom);
      }
    }
    return coveredUntil - bounds.top + 8;
  }

  function syncTheme() {
    const root = document.documentElement;
    const declared = root.getAttribute("data-theme") || root.getAttribute("data-color-scheme");
    const dark = root.classList.contains("dark") || declared === "dark"
      || (!root.classList.contains("light") && declared !== "light"
        && getComputedStyle(root).colorScheme === "dark")
      || (!root.classList.contains("light") && !declared
        && !root.classList.contains("dark")
        && getComputedStyle(root).colorScheme !== "light"
        && matchMedia("(prefers-color-scheme: dark)").matches);
    nav.dataset.theme = dark ? "dark" : "light";
    // Share the same theme variables with the sibling preview.
    preview.classList.toggle("dark", dark);
    preview.style.cssText = dark
      ? "--ink:#ededf4;--muted:#a0a0ad;--accent:#a2a9ff;--surface:#25252c;--border:#3d3d48;--shadow:0 12px 38px #0005,0 2px 8px #0003;color-scheme:dark"
      : "--ink:#343840;--muted:#858993;--accent:#6873ed;--surface:#fff;--border:#e9eaf0;--shadow:0 12px 38px #19203c16,0 2px 8px #19203c0a;color-scheme:light";
    if (previewedIndex >= 0) positionPreview(previewedIndex);
  }

  function hidePreview() {
    clearTimeout(hideTimer);
    const button = list.children[previewedIndex];
    button?.removeAttribute("aria-describedby");
    preview.hidden = true;
    previewedIndex = -1;
  }

  function deferHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePreview, 140);
  }

  function positionPreview(index) {
    const button = list.children[index];
    if (!button) return hidePreview();
    const rect = button.getBoundingClientRect();
    const rail = list.getBoundingClientRect();
    if (rect.bottom <= rail.top || rect.top >= rail.bottom) return hidePreview();
    const desired = rect.top + rect.height / 2 - preview.offsetHeight / 2;
    const top = Math.max(16, Math.min(desired, innerHeight - preview.offsetHeight - 16));
    preview.style.top = `${top}px`;
  }

  function showPreview(index) {
    if (!entries[index]) return;
    clearTimeout(hideTimer);
    if (previewedIndex !== index) {
      list.children[previewedIndex]?.removeAttribute("aria-describedby");
      previewText.textContent = entries[index].text;
      preview.scrollTop = 0;
    }
    previewedIndex = index;
    previewIndex.textContent = `${String(index + 1).padStart(2, "0")} / ${entries.length}`;
    previewHint.textContent = "点击短横杠，跳到这条提问";
    list.children[index].setAttribute("aria-describedby", preview.id);
    preview.hidden = false;
    positionPreview(index);
  }

  function updateActive() {
    frame = 0;
    if (nav.hidden || !entries.length) return;
    scrollContainer = findScrollContainer(entries[0].question);
    const bounds = viewportBounds();
    const readingLine = bounds.top + Math.min(160, (bounds.bottom - bounds.top) * 0.28);
    let next = 0;
    for (let index = 0; index < entries.length; index++) {
      const target = scrollAnchor(entries[index].question);
      if (!target) continue;
      if (target.getBoundingClientRect().top <= readingLine) next = index;
    }
    // At the bottom, the final question may sit below the reading line.
    const scroller = scrollContainer;
    const range = scrollRange(scroller);
    if (scroller.scrollHeight > scroller.clientHeight + 1
      && Math.abs(range.maximum - scroller.scrollTop) < 3) {
      next = entries.length - 1;
    }
    if (next !== activeIndex) {
      list.children[activeIndex]?.removeAttribute("aria-current");
      activeIndex = next;
      const button = list.children[next];
      button.setAttribute("aria-current", "true");
      // Keep the current marker visible without stealing focus or scrolling
      // the conversation. While hovering, leave the rail under the pointer.
      if (!nav.matches(":hover") && !list.contains(shadow.activeElement)) {
        const top = button.offsetTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + button.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = top + button.offsetHeight - list.clientHeight;
        }
      }
    }
    count.textContent = `${next + 1}/${entries.length}`;
    count.title = `当前第 ${next + 1} 个问题，共 ${entries.length} 个问题`;
    if (previewedIndex >= 0) positionPreview(previewedIndex);
  }

  function scheduleActive() {
    if (!frame) frame = requestAnimationFrame(updateActive);
  }

  function cancelJump() {
    jumpToken++;
    pendingJumpCleanup?.();
    if (lastJump?.status === "checking" || lastJump?.status === "waiting") lastJump.status = "cancelled";
  }

  function jumpTo(entry, source) {
    if (!entry) return;
    cancelJump();
    const selected = { ...entry };
    const token = jumpToken;
    const path = location.pathname;
    const deadline = performance.now() + 2500;
    const index = entries.findIndex(item => item.key === selected.key);
    hidePreview();
    lastJump = { questionIndex: index + 1, status: "checking", source,
      before: null, after: null, attempts: 0, reason: null };
    let timer = 0;
    let previousPlacement = null;
    const observer = new MutationObserver(() => schedule(40));
    observer.observe(threadRoot || document.documentElement, { childList: true, subtree: true, characterData: true });
    const cleanup = () => {
      clearTimeout(timer);
      observer.disconnect();
      if (pendingJumpCleanup === cleanup) pendingJumpCleanup = null;
    };
    pendingJumpCleanup = cleanup;

    function finish(status, reason = null) {
      cleanup();
      if (token !== jumpToken) return;
      lastJump.status = status;
      lastJump.reason = reason;
      if (status === "failed" || status === "missing") {
        const currentIndex = entries.findIndex(item => item.key === selected.key);
        if (currentIndex >= 0) {
          showPreview(currentIndex);
          previewHint.textContent = "未能定位这条提问，请点插件图标查看跳转状态。";
        }
      }
    }

    function schedule(delay = 80) {
      if (!timer) timer = setTimeout(attempt, delay);
    }

    function attempt() {
      timer = 0;
      if (token !== jumpToken || path !== location.pathname) { cleanup(); return; }
      try {
        const fresh = collectEntries().find(item => item.key === selected.key);
        if (fresh) {
          selected.identity = fresh.identity;
        }
        // Preserve the clicked prompt identity even while its entire role
        // marker is absent. A temporary unmount isn't a reason to jump elsewhere.
        const resolved = resolveIdentity(selected.identity);
        const target = resolved?.anchor;
        lastJump.attempts++;
        if (target) {
          scrollContainer = findScrollContainer(target);
          const bounds = viewportBounds();
          const offset = topOffset(scrollContainer);
          const rect = target.getBoundingClientRect();
          const requested = scrollContainer.scrollTop + rect.top - bounds.top - offset;
          if (lastJump.before === null) lastJump.before = Math.round(scrollContainer.scrollTop);
          // Let the browser clamp its own range. In a bottom-anchored reverse
          // chat, earlier messages require NEGATIVE offsets and zero is bottom.
          if (Math.abs(requested - scrollContainer.scrollTop) > 2) {
            if (scrollContainer === document.scrollingElement) window.scrollTo({ top: requested, behavior: "instant" });
            else if (getComputedStyle(scrollContainer).scrollBehavior === "smooth") {
              scrollContainer.scrollTo({ top: requested, behavior: "instant" });
            } else scrollContainer.scrollTop = requested;
          }
          const range = scrollRange(scrollContainer);
          const desired = Math.min(range.maximum, Math.max(range.minimum, requested));
          const landedRect = target.getBoundingClientRect();
          lastJump.after = Math.round(scrollContainer.scrollTop);
          lastJump.requested = Math.round(requested);
          lastJump.direction = range.reverse ? "reverse" : "normal";
          lastJump.minimum = Math.round(range.minimum);
          lastJump.maximum = Math.round(range.maximum);
          lastJump.offset = Math.round(landedRect.top - bounds.top);
          lastJump.container = scrollContainer === document.scrollingElement
            ? "window" : `${scrollContainer.tagName.toLowerCase()} (${getComputedStyle(scrollContainer).overflowY})`;
          const placed = resolved?.ready && landedRect.width > 0 && landedRect.height > 0
            && landedRect.top >= bounds.top - 2 && landedRect.top < bounds.bottom
            && Math.abs(desired - scrollContainer.scrollTop) < 3;
          if (placed && previousPlacement?.target === target
            && Math.abs(previousPlacement.top - landedRect.top) < 3) {
            finish("landed");
            scheduleActive();
            return;
          }
          previousPlacement = placed ? { target, top: landedRect.top } : null;
          lastJump.status = resolved?.ready ? "checking" : "waiting";
          scheduleActive();
        } else {
          previousPlacement = null;
          lastJump.status = "waiting";
        }
        if (performance.now() >= deadline) {
          finish(target ? "failed" : "missing", !resolved?.ready ? "target-not-rendered" : "scroll-position-not-stable");
        } else schedule();
      } catch {
        finish("failed", "navigation-error");
      }
    }
    attempt();
  }

  function createButton(entry, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mark";
    button.dataset.index = String(index);
    button.dataset.entryKey = entry.key;
    button.setAttribute("aria-label", `问题 ${index + 1}：${entry.text}`);
    button.addEventListener("mouseenter", () => showPreview(Number(button.dataset.index)));
    button.addEventListener("mouseleave", deferHide);
    button.addEventListener("focus", () => showPreview(Number(button.dataset.index)));
    button.addEventListener("blur", deferHide);
    return button;
  }

  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = 0;
    const pathChanged = currentPath !== location.pathname;
    if (pathChanged) { cancelJump(); lastJump = null; promptText.clear(); knownEntries.clear(); pointerSelection = null; }
    currentPath = location.pathname;
    const next = collectEntries();
    const changed = next.length !== entries.length || next.some((entry, index) => {
      const previous = entries[index];
      return !previous || entry.key !== previous.key || entry.question !== previous.question || entry.text !== previous.text;
    });
    if (changed && pointerSelection?.held && performance.now() - pointerSelection.time < 1000) {
      scheduleRefresh();
      return;
    }
    entries = next;
    if (changed || pathChanged) {
      hidePreview();
      const previousScroll = pathChanged ? 0 : list.scrollTop;
      const oldButtons = new Map([...list.children].map(button => [button.dataset.entryKey, button]));
      const retained = new Set();
      entries.forEach((entry, index) => {
        const button = !pathChanged && oldButtons.get(entry.key) || createButton(entry, index);
        button.dataset.index = String(index);
        button.setAttribute("aria-label", `问题 ${index + 1}：${entry.text}`);
        retained.add(button);
        if (list.children[index] !== button) list.insertBefore(button, list.children[index] || null);
      });
      for (const button of [...list.children]) if (!retained.has(button)) button.remove();
      list.scrollTop = previousScroll;
      activeIndex = -1;
      for (const button of list.children) button.removeAttribute("aria-current");
    }
    nav.hidden = entries.length === 0;
    if (nav.hidden) hidePreview();
    else if (previewedIndex >= 0) showPreview(previewedIndex);
    syncTheme();
    scheduleActive();
  }

  function scheduleRefresh() {
    if (!refreshTimer) refreshTimer = setTimeout(refresh, 120);
  }

  function handleNavigationKey(event, button) {
    if (!button) return false;
    const index = Number(button.dataset.index);
    if (!Number.isInteger(index)) return false;
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(index + 1, entries.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    else if (event.key === "Escape") { hidePreview(); return true; }
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      clickCount++;
      jumpTo(entries.find(entry => entry.key === button.dataset.entryKey), "keyboard");
      return true;
    } else return false;
    event.preventDefault();
    const nextButton = list.children[next];
    nextButton.focus({ preventScroll: true });
    list.scrollTop = Math.max(0, nextButton.offsetTop - list.clientHeight / 2);
    showPreview(next);
    return true;
  }
  list.addEventListener("keydown", event => handleNavigationKey(event, event.target.closest(".mark")));
  forwardNavigationEvent = event => {
    if (event.type === "pointerup" || event.type === "pointercancel") {
      if (pointerSelection) { pointerSelection.held = false; scheduleRefresh(); }
      return;
    }
    const button = event.composedPath().find(node => node instanceof Element
      && node.classList.contains("mark") && node.getRootNode() === shadow);
    if (!button) return;
    if (event.type === "keydown") {
      if (handleNavigationKey(event, button)) event.stopImmediatePropagation();
      return;
    }
    if (event.button !== 0) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const entry = entries.find(item => item.key === button.dataset.entryKey);
    if (event.type === "pointerdown") {
      pointerSelection = { button, entry, time: performance.now(), held: true };
      button.focus({ preventScroll: true });
    } else if (event.type === "click") {
      const selected = pointerSelection?.button === button && performance.now() - pointerSelection.time < 1500
        ? pointerSelection.entry : entry;
      pointerSelection = null;
      clickCount++;
      jumpTo(selected, event.isTrusted ? "mouse" : "script");
    }
  };
  preview.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  preview.addEventListener("mouseleave", deferHide);
  list.addEventListener("scroll", () => {
    if (previewedIndex >= 0) positionPreview(previewedIndex);
  }, { passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePreview();
  });
  // Capture catches scroll events from ChatGPT's nested scrolling pane.
  document.addEventListener("scroll", scheduleActive, { passive: true, capture: true });
  document.addEventListener("wheel", cancelJump, { passive: true, capture: true });
  document.addEventListener("touchstart", cancelJump, { passive: true, capture: true });
  window.addEventListener("resize", scheduleActive, { passive: true });
  window.addEventListener("popstate", scheduleRefresh);
  window.addEventListener("pageshow", scheduleRefresh);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
  const observer = new MutationObserver((mutations) => {
    // A hydration or route render can remove DOM added by an extension.
    if (!host.isConnected) document.documentElement.append(host);
    if (mutations.some((mutation) => mutation.target !== host && !host.contains(mutation.target))) {
      scheduleRefresh();
    }
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["data-message-author-role", "data-conversation-role", "data-turn",
      "data-user-message-bubble", "data-chatgpt-search-unit-key", "data-chatgpt-agent-turn-start",
      "hidden", "aria-hidden", "class", "style", "data-theme", "data-color-scheme"]
  });
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "conversation-navigator:status") return;
      refresh();
      sendResponse({
        version: VERSION,
        questionCount: entries.length,
        markerCount: document.querySelectorAll(MESSAGE_SELECTOR).length,
        visible: !nav.hidden && host.isConnected,
        domain: location.hostname,
        clickCount,
        lastJump
      });
    });
  }
  refresh();
  }

  if (document.documentElement) start();
  else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      start();
    });
    observer.observe(document, { childList: true });
  }
})();
