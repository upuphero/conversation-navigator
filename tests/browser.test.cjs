"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const artifactDir = path.join(__dirname, "artifacts");
const candidates = [process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const chrome = candidates.find(candidate => candidate && fs.existsSync(candidate));

function removeTemporaryProfile(profile) {
  const resolved = path.resolve(profile);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("conversation-navigator-test-"));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// Use Chrome's DevTools protocol directly, so the extension and its tests need
// no npm packages. The profile is temporary and never uses a personal session.
async function launchBrowser() {
  assert.ok(chrome, "Chrome not found. Set CHROME_PATH to the Chrome executable.");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-navigator-test-"));
  const processHandle = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let output = "";
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome DevTools startup timed out")), 15000);
    processHandle.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    processHandle.once("error", error => { clearTimeout(timeout); reject(error); });
    processHandle.once("exit", code => { clearTimeout(timeout); reject(new Error(`Chrome exited: ${code}`)); });
  }).catch(error => {
    processHandle.kill();
    removeTemporaryProfile(profile);
    throw error;
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`DevTools request timed out: ${method}`));
    }, 10000);
    pending.set(requestId, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression, contextId) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + " "
      + (result.exceptionDetails.exception?.description || ""));
    return result.result.value;
  };
  return { command, evaluate, async close() {
    try { await send("Browser.close"); } catch { processHandle.kill(); }
    socket.close();
    if (processHandle.exitCode === null) {
      await Promise.race([new Promise(resolve => processHandle.once("exit", resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    if (processHandle.exitCode === null) processHandle.kill();
    removeTemporaryProfile(profile);
  } };
}

test("Chrome: preview, prompt navigation, live updates, long conversations and themes", { timeout: 60000 }, async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts[0].run_at, "document_start");
  for (const file of manifest.content_scripts[0].js) assert.ok(fs.existsSync(path.join(root, file)));
  assert.ok(fs.existsSync(path.join(root, manifest.action.default_popup)));
  assert.equal(manifest.permissions, undefined, "Diagnostics must not add permissions");
  const browser = await launchBrowser();
  const evaluate = browser.evaluate;
  const waitFor = async (condition, description) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await evaluate(condition)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out: ${description}`);
  };
  try {
    await browser.command("Page.enable");
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await browser.command("Page.navigate", { url: pathToFileURL(path.join(__dirname, "fixture.html")).href });
    await waitFor("document.querySelectorAll('[data-message-author-role=user]').length === 6", "fixture loading");
    await evaluate("chrome.runtime = {onMessage:{addListener: listener => { window.navigatorStatusListener = listener }}};");
    await evaluate(fs.readFileSync(path.join(root, "content.js"), "utf8"));
    await evaluate("window.ui = document.getElementById('conversation-navigator-extension').shadowRoot");
    await waitFor("ui.querySelectorAll('.mark').length === 6 && ui.querySelector('.count').textContent === '1/6'", "initial navigation");

    await evaluate("ui.querySelectorAll('.mark')[2].dispatchEvent(new MouseEvent('mouseenter'))");
    assert.equal(await evaluate("ui.querySelector('.preview-text').textContent"), "导航列能不能只显示短横杠，鼠标移上去再显示问题？");
    assert.equal(await evaluate("ui.querySelector('.preview').hidden"), false);
    assert.ok(await evaluate("ui.querySelector('.preview').getBoundingClientRect().top >= 16"));
    fs.mkdirSync(artifactDir, { recursive: true });
    const screenshot = await browser.command("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(artifactDir, "navigator.png"), Buffer.from(screenshot.data, "base64"));

    await evaluate("ui.querySelectorAll('.mark')[3].click()");
    await waitFor("ui.querySelectorAll('.mark')[3].getAttribute('aria-current') === 'true'", "prompt selection");
    const gap = await evaluate("document.querySelectorAll('[data-message-author-role=user]')[3].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top");
    assert.ok(Math.abs(gap - 8) < 2, `Expected 8px gap below the scrolling pane, got ${gap}`);
    assert.ok(await evaluate("document.querySelectorAll('[data-message-author-role=assistant]')[3].getBoundingClientRect().top >= document.querySelectorAll('[data-message-author-role=user]')[3].getBoundingClientRect().bottom"), "The question should be at the top with its answer below it");
    assert.equal(await evaluate("ui.querySelector('.preview').hidden"), true);

    await evaluate("addTurn('还没有回答的问题', null)");
    await waitFor("ui.querySelectorAll('.mark').length === 7", "new prompt");
    await evaluate("ui.querySelectorAll('.mark')[6].dispatchEvent(new MouseEvent('mouseenter'))");
    assert.match(await evaluate("ui.querySelector('.preview-hint').textContent"), /跳到这条提问/);
    await evaluate("ui.querySelectorAll('.mark')[6].click()");
    await waitFor("ui.querySelector('.count').textContent === '7/7'", "unanswered prompt fallback");
    await evaluate("ui.querySelectorAll('.mark')[6].dispatchEvent(new MouseEvent('mouseenter'))");
    await evaluate(`(() => { const reply = document.createElement('div'); reply.dataset.messageAuthorRole = 'assistant'; reply.style.height = '500px'; reply.textContent = '新回答'; document.querySelector('main').lastElementChild.append(reply); })()`);
    await waitFor("ui.querySelector('.preview-hint').textContent.includes('跳到这条提问')", "answer arrival keeps the prompt navigation hint");
    await evaluate("ui.querySelectorAll('.mark')[6].click()");
    await waitFor("ui.querySelector('.count').textContent === '7/7'", "last prompt jump");
    await evaluate("document.querySelector('main').lastElementChild.querySelector('[data-message-author-role=assistant]').replaceWith(Object.assign(document.createElement('div'), {textContent: '重新生成的回答', className: 'replacement-answer'})); document.querySelector('.replacement-answer').setAttribute('data-message-author-role', 'assistant'); document.querySelector('.replacement-answer').style.height = '900px'");
    await waitFor("ui.querySelectorAll('.mark').length === 7", "regenerated answer");
    // Wait for the observer to bind the replacement, then move away and back.
    await evaluate("new Promise(resolve => setTimeout(resolve, 180))");
    await evaluate("ui.querySelectorAll('.mark')[0].click()");
    await waitFor("ui.querySelector('.count').textContent === '1/7'", "move away from regenerated answer");
    await evaluate("ui.querySelectorAll('.mark')[6].click()");
    await waitFor("ui.querySelector('.count').textContent === '7/7'", "regenerated answer jump");
    assert.ok(await evaluate("Math.abs(document.querySelector('main').lastElementChild.querySelector('[data-message-author-role=user]').getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2"), "Regenerating the answer must keep the jump aimed at the user's prompt");

    await evaluate("document.querySelector('main').lastElementChild.querySelector('.whitespace-pre-wrap').textContent = '<img src=x onerror=alert(1)> 修改后的提问'");
    await waitFor("ui.querySelectorAll('.mark')[6].getAttribute('aria-label').includes('修改后的提问')", "edited prompt");
    await evaluate("ui.querySelectorAll('.mark')[6].dispatchEvent(new MouseEvent('mouseenter'))");
    assert.equal(await evaluate("ui.querySelector('.preview-text').children.length"), 0, "Prompt text must never become HTML");

    await evaluate("document.documentElement.className = 'dark'");
    await waitFor("ui.querySelector('.navigator').dataset.theme === 'dark'", "dark theme");
    assert.equal(await evaluate("getComputedStyle(ui.querySelector('.preview')).backgroundColor"), "rgb(37, 37, 44)");

    await evaluate("for (let i = 0; i < 100; i++) addTurn('长对话问题 ' + (i + 8))");
    await waitFor("ui.querySelectorAll('.mark').length === 107", "long conversation updates");
    assert.ok(await evaluate("ui.querySelector('.list').scrollHeight > ui.querySelector('.list').clientHeight"), "Long rail should scroll");
    await evaluate("document.querySelector('main').scrollTop = 0");
    await waitFor("ui.querySelector('.count').textContent === '1/107'", "scroll tracking");
    await evaluate("ui.querySelector('.mark').focus(); ui.querySelector('.mark').dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}))");
    assert.equal(await evaluate("ui.activeElement.dataset.index"), "106");
    assert.ok(await evaluate("ui.querySelector('.list').scrollTop > 0"), "Keyboard should reveal the focused marker");
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitFor("ui.querySelector('.count').textContent === '107/107'", "native Enter jump");
    await evaluate("ui.querySelectorAll('.mark')[106].dispatchEvent(new MouseEvent('mouseenter')); ui.querySelector('.list').scrollTop = 0");
    await waitFor("ui.querySelector('.preview').hidden", "rail scroll hides an offscreen preview");
    await evaluate("ui.querySelectorAll('.mark')[106].dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}))");
    await evaluate("ui.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
    assert.equal(await evaluate("ui.querySelector('.preview').hidden"), true);

    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate("ui.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}))");
    await evaluate("ui.querySelectorAll('.mark')[106].dispatchEvent(new MouseEvent('mouseenter'))");
    assert.equal(await evaluate("ui.querySelector('.preview').hidden"), false);
    assert.ok(await evaluate("ui.querySelector('.preview').getBoundingClientRect().left >= 0"), "Small viewport preview should fit");

    await evaluate("document.querySelector('main').replaceChildren(); history.pushState({}, '', '#another-conversation'); addTurn('切换后的唯一问题')");
    await waitFor("ui.querySelectorAll('.mark').length === 1 && ui.querySelector('.count').textContent === '1/1'", "conversation replacement");
    await evaluate(fs.readFileSync(path.join(root, "content.js"), "utf8"));
    assert.equal(await evaluate("document.querySelectorAll('#conversation-navigator-extension').length"), 1, "Injection must be idempotent");
    await evaluate("document.querySelector('main').replaceChildren()");
    await waitFor("ui.querySelector('.navigator').hidden", "empty conversation");
    assert.equal(await evaluate("ui.querySelector('.preview').hidden"), true);

    await evaluate(`(() => {
      const main = document.querySelector('main');
      for (let i = 0; i < 3; i++) {
        const group = document.createElement('section');
        group.dataset.turnKey = 'modern-' + i;
        const bubble = document.createElement('div');
        bubble.setAttribute('data-user-message-bubble', '');
        bubble.innerHTML = '<p>新版问题 ' + (i + 1) + '</p><p>第二行</p><button>复制</button>';
        const answer = document.createElement('div');
        answer.dataset.conversationRole = 'assistant';
        answer.style.minHeight = '900px';
        answer.textContent = '新版回答 ' + (i + 1);
        const start = document.createElement('span');
        start.setAttribute('data-chatgpt-agent-turn-start', '');
        answer.prepend(start);
        group.append(bubble, answer);
        main.append(group);
      }
    })()`);
    await waitFor("ui.querySelectorAll('.mark').length === 3", "new grouped ChatGPT renderer");
    assert.equal(await evaluate("document.querySelectorAll('[data-message-author-role]').length"), 0, "Regression fixture must have no legacy role markers");
    const runtimeStatus = await evaluate("(() => { let reply; navigatorStatusListener({type:'conversation-navigator:status'}, {}, response => {reply = response}); return reply })()");
    assert.equal(runtimeStatus.questionCount, 3);
    assert.equal(runtimeStatus.version, manifest.version);
    assert.equal(runtimeStatus.visible, true);
    assert.equal(runtimeStatus.questions, undefined, "Diagnostics must not disclose message content");
    await evaluate("ui.querySelectorAll('.mark')[1].dispatchEvent(new MouseEvent('mouseenter'))");
    assert.equal(await evaluate("ui.querySelector('.preview-text').textContent"), "新版问题 2\n第二行");
    await evaluate("ui.querySelectorAll('.mark')[1].click()");
    await waitFor("ui.querySelector('.count').textContent === '2/3'", "modern prompt jump");
    assert.ok(await evaluate("Math.abs(document.querySelectorAll('[data-user-message-bubble]')[1].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2"));

    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(() => {
      for (const answer of document.querySelectorAll('[data-conversation-role=assistant]')) {
        const body = document.createElement('div');
        body.className = 'markdown answer-body';
        body.style.minHeight = '900px';
        body.append(...answer.childNodes);
        answer.style.display = 'contents';
        answer.append(body);
      }
      document.querySelector('main').scrollTop = 0;
    })()`);
    await evaluate("new Promise(resolve => setTimeout(resolve, 180))");
    const clickMarker = async index => {
      const point = await evaluate(`(() => { const rect = ui.querySelectorAll('.mark')[${index}].getBoundingClientRect(); return {x:rect.x + rect.width/2, y:rect.y + rect.height/2} })()`);
      await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    };
    await clickMarker(1);
    await waitFor("Math.abs(document.querySelectorAll('[data-user-message-bubble]')[1].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2", "real mouse click reaches the question regardless of the answer wrapper's layout");
    assert.ok(await evaluate("document.querySelector('main').scrollTop > 700"), "The actual conversation must scroll, not just change the highlighted marker");

    await evaluate("document.querySelector('main').style.overflowY = 'hidden'; document.querySelector('main').scrollTop = 0");
    await evaluate("new Promise(resolve => setTimeout(resolve, 180))");
    await clickMarker(2);
    await waitFor("Math.abs(document.querySelectorAll('[data-user-message-bubble]')[2].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2", "programmatic prompt navigation through overflow:hidden scrolling pane");
    assert.ok(await evaluate("document.querySelector('main').scrollTop > 1500"));
    await waitFor("(() => { let reply; navigatorStatusListener({type:'conversation-navigator:status'}, {}, result => {reply = result}); return reply.lastJump?.status === 'landed' })()", "jump verifies its actual landing");
    const jumpStatus = await evaluate("(() => { let reply; navigatorStatusListener({type:'conversation-navigator:status'}, {}, result => {reply = result}); return reply.lastJump })()");
    assert.equal(jumpStatus.questionIndex, 3);
    assert.ok(jumpStatus.after > jumpStatus.before);
    assert.match(jumpStatus.container, /hidden/);

    await evaluate("document.querySelector('main').scrollTop = 0");
    await clickMarker(2);
    await evaluate(`(() => {
      const answer = document.querySelectorAll('[data-conversation-role=assistant]')[2];
      const replacement = answer.cloneNode(true);
      answer.replaceWith(replacement);
      const spacer = document.createElement('div');
      spacer.style.height = '240px';
      replacement.before(spacer);
    })()`);
    await waitFor("Math.abs(document.querySelectorAll('[data-user-message-bubble]')[2].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2", "answer replacement must not move navigation away from its prompt");
    await waitFor("(() => { let reply; navigatorStatusListener({type:'conversation-navigator:status'}, {}, result => {reply = result}); return reply.lastJump?.status === 'landed' })()", "remounted answer landing is verified");

    await evaluate("document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.querySelector('main').style.height = 'auto'; document.querySelector('main').style.overflowY = 'visible'; window.scrollTo(0,0)");
    await clickMarker(2);
    await waitFor("window.scrollY > 1500 && Math.abs(document.querySelectorAll('[data-user-message-bubble]')[2].getBoundingClientRect().top - 8) < 2", "document viewport scrolling to a prompt instead of a nested pane");
    await waitFor("(() => { let reply; navigatorStatusListener({type:'conversation-navigator:status'}, {}, result => {reply = result}); return reply.lastJump?.status === 'landed' && reply.lastJump.container === 'window' })()", "viewport landing is verified");
    await evaluate("window.scrollTo(0,0); document.documentElement.style.height = ''; document.body.style.height = ''; document.querySelector('main').style.height = ''");
    await evaluate("document.querySelector('main').style.overflowY = 'auto'");

    await evaluate(`window.readNavigatorStatus = () => { let reply; navigatorStatusListener({type:'conversation-navigator:status'}, {}, result => { reply = result }); return reply };
      window.blockedClicks = 0;
      document.addEventListener('click', event => {
        if (event.target.id === 'conversation-navigator-extension') { window.blockedClicks++; event.stopImmediatePropagation() }
      }, true);
      document.getElementById('conversation-navigator-extension').click();`);
    assert.equal(await evaluate("blockedClicks"), 1, "The fixture's page delegate must actually intercept an unhandled host click");
    await evaluate("document.querySelector('main').scrollTop = 0");
    await clickMarker(1);
    await waitFor("readNavigatorStatus().lastJump?.status === 'landed' && readNavigatorStatus().lastJump.questionIndex === 2", "capture navigation before the page stops its click");
    assert.equal(await evaluate("blockedClicks"), 1, "The page's document delegate must not swallow navigation");

    await evaluate(`(() => {
      const first = document.querySelector('[data-turn-key="modern-0"]');
      const second = document.querySelector('[data-turn-key="modern-1"]');
      const answer = first.querySelector('[data-conversation-role=assistant]');
      const question = second.querySelector('[data-user-message-bubble]');
      first.style.minHeight = '1000px';
      answer.remove(); question.remove();
      const unknown = document.createElement('section');
      unknown.dataset.turnKey = 'never-seen-question';
      const unrelated = document.createElement('div');
      unrelated.dataset.conversationRole = 'assistant';
      unrelated.style.minHeight = '900px';
      unrelated.textContent = '一个从未加载过提问的独立回答';
      unknown.append(unrelated); first.after(unknown);
      window.restorePartialTurns = () => {first.append(answer);second.prepend(question);unknown.remove()};
    })()`);
    await evaluate("new Promise(resolve => setTimeout(resolve, 180))");
    await clickMarker(0);
    await evaluate("new Promise(resolve => setTimeout(resolve, 300))");
    assert.equal(await evaluate("readNavigatorStatus().lastJump.status"), "landed", "A rendered prompt must be navigable while its answer is unmounted");
    assert.ok(await evaluate("document.querySelector('[data-turn-key=modern-0] [data-user-message-bubble]').getBoundingClientRect().top >= document.querySelector('main').getBoundingClientRect().top"), "The first prompt must be visible even when there is no answer");
    await evaluate("restorePartialTurns()");
    await waitFor("readNavigatorStatus().lastJump?.status === 'landed'", "answer remount leaves the completed prompt navigation intact");

    await evaluate(`(() => {
      const group = document.querySelector('[data-turn-key="modern-1"]');
      const children = [...group.childNodes];
      group.style.minHeight = '1000px';
      group.replaceChildren();
      setTimeout(() => group.append(...children), 700);
    })()`);
    await evaluate("new Promise(resolve => setTimeout(resolve, 180))");
    assert.equal(await evaluate("ui.querySelectorAll('.mark').length"), 3, "Unmounted grouped turns should retain their previously read prompts");
    assert.match(await evaluate("ui.querySelectorAll('.mark')[1].getAttribute('aria-label')"), /新版问题 2/);
    await clickMarker(1);
    await waitFor("readNavigatorStatus().lastJump?.status === 'waiting'", "wait for an unmounted grouped prompt");
    await waitFor("readNavigatorStatus().lastJump?.status === 'landed' && Math.abs(document.querySelector('[data-turn-key=modern-1] [data-user-message-bubble]').getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2", "re-query the prompt after grouped contents mount");

    await evaluate("document.getElementById('conversation-navigator-extension').remove()");
    await waitFor("document.getElementById('conversation-navigator-extension')?.shadowRoot === ui", "UI restored after page hydration");

    await evaluate(`(() => {
      const main = document.querySelector('main');
      main.replaceChildren();
      for (const role of ['user', 'assistant', 'user', 'assistant']) {
        const turn = document.createElement('section');
        turn.dataset.turn = role;
        turn.dataset.testid = 'conversation-turn-' + main.children.length;
        turn.textContent = role === 'user' ? '按轮次识别的问题' : '按轮次识别的回答';
        main.append(turn);
      }
    })()`);
    await waitFor("ui.querySelectorAll('.mark').length === 2", "turn-shell fallback");
    await evaluate(`(() => {
      const main = document.querySelector('main');
      const panel = document.createElement('div');
      panel.style.cssText = 'height:700px;overflow-y:auto';
      panel.append(...main.childNodes);
      main.replaceWith(panel);
    })()`);
    await waitFor("ui.querySelectorAll('.mark').length === 2 && !ui.querySelector('.navigator').hidden", "layout without main landmark");

    await evaluate(`(() => {
      const panel = document.querySelector('[data-turn]').parentElement;
      panel.id = 'thread';
      panel.replaceChildren();
      for (let index = 0; index < 3; index++) {
        const question = document.createElement('section');
        question.dataset.turn = 'user'; question.dataset.turnId = 'prompt-' + index;
        question.textContent = '带回合 ID 的问题 ' + index;
        const answer = document.createElement('section');
        answer.dataset.turn = 'assistant'; answer.dataset.turnId = 'reply-' + index;
        answer.style.minHeight = '900px';
        const text = document.createElement('div');
        text.className = 'markdown'; text.textContent = '带回合 ID 的回答 ' + index;
        answer.append(text); panel.append(question, answer);
      }
    })()`);
    await waitFor("ui.querySelectorAll('.mark').length === 3", "stable turn-ID model");
    await evaluate("window.savedMarker = ui.querySelectorAll('.mark')[1]; document.querySelector('[data-turn-id=prompt-1]').replaceWith(document.querySelector('[data-turn-id=prompt-1]').cloneNode(true)); document.querySelector('[data-turn-id=reply-1]').replaceWith(document.querySelector('[data-turn-id=reply-1]').cloneNode(true))");
    await evaluate("new Promise(resolve => setTimeout(resolve, 180))");
    assert.equal(await evaluate("ui.querySelectorAll('.mark')[1] === savedMarker"), true, "A turn remount must not replace its navigation button");
    await clickMarker(1);
    await waitFor("readNavigatorStatus().lastJump?.status === 'landed' && Math.abs(document.querySelector('[data-turn-id=prompt-1]').getBoundingClientRect().top - document.getElementById('thread').getBoundingClientRect().top - 8) < 2", "jump to the full replacement prompt turn by its stable ID");

    // Replace both nodes after the click, then remount with only turn IDs
    // retained. The delay exceeds the old 300ms retry window.
    await evaluate("document.getElementById('thread').scrollTop = 0");
    await clickMarker(1);
    await evaluate(`(() => {
      const question = document.querySelector('[data-turn-id=prompt-1]');
      const answer = document.querySelector('[data-turn-id=reply-1]');
      const next = answer.nextSibling;
      const newQuestion = question.cloneNode(true), newAnswer = answer.cloneNode(true);
      question.remove(); answer.remove();
      setTimeout(() => { const panel = document.getElementById('thread'); panel.insertBefore(newQuestion, next); panel.insertBefore(newAnswer, next) }, 700);
    })()`);
    await waitFor("readNavigatorStatus().lastJump?.status === 'waiting'", "a missing turn waits instead of abandoning the click");
    await waitFor("readNavigatorStatus().lastJump?.status === 'landed' && Math.abs(document.querySelector('[data-turn-id=prompt-1]').getBoundingClientRect().top - document.getElementById('thread').getBoundingClientRect().top - 8) < 2", "stable prompt turn ID survives full removal and delayed replacement");

    await evaluate("document.getElementById('thread').scrollTop = 0; document.getElementById('thread').style.cssText = 'height:700px;overflow-y:auto;position:relative'; document.querySelector('header').style.cssText = 'position:fixed;top:0;height:128px;z-index:10;background:white'");
    await clickMarker(1);
    await waitFor("readNavigatorStatus().lastJump?.status === 'landed' && Math.abs(document.querySelector('[data-turn-id=prompt-1]').getBoundingClientRect().top - 136) < 2", "keep the prompt below an overlapping 128px top bar");
    await evaluate("document.querySelector('header').style.cssText = ''");

    await browser.command("Page.addScriptToEvaluateOnNewDocument", { source:
      `window.chrome.runtime = {getManifest: () => ({version:'${manifest.version}'})};
       window.chrome.tabs = {query:async () => [{id:1}], sendMessage:async () => ({version:'${manifest.version}',questionCount:3,markerCount:6,visible:true})};` });
    await browser.command("Page.navigate", { url: pathToFileURL(path.join(root, "popup.html")).href });
    await waitFor("document.getElementById('status').textContent.includes('已识别 3 个问题')", "popup reports detected messages");
    await evaluate(`chrome.tabs.sendMessage = async () => ({version:'${manifest.version}',questionCount:0,markerCount:0,visible:false}); document.getElementById('rescan').click()`);
    await waitFor("document.getElementById('status').textContent.includes('暂未识别')", "popup reports selector mismatch");
    await evaluate("chrome.tabs.sendMessage = async () => { throw new Error('No receiver') }; document.getElementById('rescan').click()");
    await waitFor("document.getElementById('status').textContent.includes('未连接导航脚本')", "popup reports missing injection");
    await evaluate("chrome.tabs.sendMessage = async () => ({version:'0.1.1'}); document.getElementById('rescan').click()");
    await waitFor("document.getElementById('status').textContent.includes('旧版导航脚本')", "popup reports stale page script");
    await evaluate(`chrome.tabs.sendMessage = async () => ({version:'${manifest.version}',questionCount:3,visible:true,lastJump:{questionIndex:2,status:'failed',before:0,after:0,offset:2000,container:'div (hidden)'}}); document.getElementById('rescan').click()`);
    await waitFor("document.getElementById('detail').textContent.includes('未定位成功')", "popup reports navigation failure instead of claiming success");
  } finally {
    await browser.close();
  }
});

test("Chrome: document_start navigation in an isolated world precedes page window delegates", { timeout: 30000 }, async () => {
  const browser = await launchBrowser();
  const waitFor = async (condition, contextId) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await browser.evaluate(condition, contextId)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out: ${condition}`);
  };
  try {
    await browser.command("Page.enable");
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.command("Page.addScriptToEvaluateOnNewDocument", {
      worldName: "conversation-navigator-isolated-tests",
      source: "globalThis.chrome = {runtime:{onMessage:{addListener:listener => {globalThis.navigatorStatusListener=listener}}}};\n"
        + fs.readFileSync(path.join(root, "content.js"), "utf8")
    });
    await browser.command("Page.navigate", { url: pathToFileURL(path.join(__dirname, "fixture.html")).href + "#capture-shield" });
    await waitFor("document.getElementById('conversation-navigator-extension')?.shadowRoot.querySelectorAll('.mark').length === 6");
    await browser.evaluate("window.ui = document.getElementById('conversation-navigator-extension').shadowRoot");
    const point = await browser.evaluate("(() => { const rect=ui.querySelectorAll('.mark')[3].getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2} })()");
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    await waitFor("Math.abs(document.querySelectorAll('[data-message-author-role=user]')[3].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2");
    assert.equal(await browser.evaluate("window.pageBlockedNavigationClicks"), 0, "The early isolated-world handler must run before the app's window capture handler");
    const tree = await browser.command("Page.getFrameTree");
    const context = await browser.command("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: "conversation-navigator-isolated-tests" });
    await waitFor("(() => {let status;navigatorStatusListener({type:'conversation-navigator:status'}, {}, reply=>{status=reply});return status.lastJump?.status === 'landed'})()", context.executionContextId);
    const status = await browser.evaluate("(() => {let status;navigatorStatusListener({type:'conversation-navigator:status'}, {}, reply=>{status=reply});return status})()", context.executionContextId);
    assert.equal(status.clickCount, 1);
    assert.equal(status.lastJump.source, "mouse");
    const pagePoint = await browser.evaluate("(() => {const rect=document.getElementById('ordinary-page-button').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()");
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...pagePoint });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...pagePoint });
    await waitFor("window.ordinaryPageClicks === 1");
  } finally {
    await browser.close();
  }
});

test("Chrome: reverse-flow chat navigates upward with negative scrollTop instead of forcing the bottom", { timeout: 30000 }, async () => {
  const browser = await launchBrowser();
  const evaluate = browser.evaluate;
  const waitFor = async (condition, description) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await evaluate(condition)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const state = await evaluate("({scrollTop:document.querySelector('main')?.scrollTop,status:window.readNavigatorStatus?.().lastJump})");
    assert.fail(`${description}: ${JSON.stringify(state)}`);
  };
  const click = async index => {
    const point = await evaluate(`(() => { const rect=ui.querySelectorAll('.mark')[${index}].getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2} })()`);
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  try {
    await browser.command("Page.enable");
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.command("Page.navigate", { url: pathToFileURL(path.join(__dirname, "fixture.html")).href });
    await waitFor("document.querySelectorAll('[data-message-author-role=user]').length === 6", "fixture loading");
    await evaluate(`(() => {
      const main = document.querySelector('main');
      const content = document.createElement('div');
      content.style.cssText = 'flex:none;width:100%';
      content.append(...main.childNodes); main.append(content);
      main.style.cssText = 'display:flex;flex-direction:column-reverse;height:700px;overflow-y:auto';
      main.scrollTop = -500;
      chrome.runtime = {onMessage:{addListener:listener => {window.navigatorStatusListener=listener}}};
    })()`);
    assert.ok(await evaluate("document.querySelector('main').scrollTop < -100"), "Regression fixture must use actual negative browser scroll positions");
    await evaluate(fs.readFileSync(path.join(root, "content.js"), "utf8"));
    await evaluate("window.ui=document.getElementById('conversation-navigator-extension').shadowRoot; window.readNavigatorStatus=()=>{let status;navigatorStatusListener({type:'conversation-navigator:status'},{},reply=>{status=reply});return status};");
    await waitFor("ui.querySelectorAll('.mark').length === 6", "reverse conversation markers");
    for (const index of [0, 2, 4]) {
      await click(index);
      const alignment = index === 0
        ? "document.querySelectorAll('[data-message-author-role=user]')[0].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top >= 8 && document.querySelectorAll('[data-message-author-role=user]')[0].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top < 80"
        : `Math.abs(document.querySelectorAll('[data-message-author-role=user]')[${index}].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2`;
      await waitFor(`document.querySelector('main').scrollTop < -3 && (${alignment}) && readNavigatorStatus().lastJump.status === 'landed'`, `marker ${index + 1} must land on its own earlier prompt`);
      assert.equal(await evaluate("readNavigatorStatus().lastJump.questionIndex"), index + 1);
    }
    await click(5);
    await waitFor("Math.abs(document.querySelector('main').scrollTop) < 2 && readNavigatorStatus().lastJump.status === 'landed' && ui.querySelector('.count').textContent === '6/6'", "the final prompt should be visible at the bottom origin");
    await evaluate("document.querySelector('main').style.flexDirection='column'; document.querySelector('main').scrollTop=0");
    await click(2);
    await waitFor("document.querySelector('main').scrollTop > 0 && Math.abs(document.querySelectorAll('[data-message-author-role=user]')[2].getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top - 8) < 2 && readNavigatorStatus().lastJump.status === 'landed'", "switching back to positive scroll coordinates should still locate the prompt");
  } finally {
    await browser.close();
  }
});
