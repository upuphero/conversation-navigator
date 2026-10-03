"use strict";

const status = document.getElementById("status");
const detail = document.getElementById("detail");
const rescan = document.getElementById("rescan");
const version = chrome.runtime.getManifest().version;
document.getElementById("version").textContent = `v${version}`;

async function checkStatus() {
  rescan.disabled = true;
  status.textContent = "正在检查当前标签页…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "conversation-navigator:status" });
    if (!response) throw new Error("No response");
    if (response.version !== version) {
      status.textContent = "页面还在使用旧版导航脚本";
      detail.textContent = "请刷新 ChatGPT 对话页，再打开此窗口检查。";
    } else if (response.questionCount > 0 && response.visible) {
      status.textContent = `脚本已连接 · 已识别 ${response.questionCount} 个问题`;
      detail.textContent = "导航位于网页右侧中部。悬停查看问题，点击跳到对应回答。";
      detail.textContent += `\n已收到导航点击：${response.clickCount || 0} 次。`;
      if (response.lastJump) {
        const jump = response.lastJump;
        const labels = { checking: "正在定位", waiting: "等待目标消息加载", landed: "已定位到目标", failed: "未定位成功", missing: "未找到目标消息", cancelled: "跳转已中断" };
        detail.textContent += `\n上次点击第 ${jump.questionIndex} 条：${labels[jump.status] || jump.status}。`;
        if (jump.after !== null) {
          detail.textContent += `\n滚动位置：${jump.before} → ${jump.after}；目标距顶部：${jump.offset}px；区域：${jump.container}。`;
          if (jump.direction) {
            detail.textContent += `\n滚动方向：${jump.direction === "reverse" ? "反向（允许负数位置）" : "普通"}；请求位置：${jump.requested}；范围：${jump.minimum} ～ ${jump.maximum}。`;
          }
        }
      }
    } else {
      status.textContent = "脚本已运行，暂未识别到问题";
      detail.textContent = `页面消息标记：${response.markerCount}。请进入已有对话并等待消息加载；若仍是 0，请把这个状态告诉我以便继续适配。`;
    }
  } catch {
    status.textContent = "当前标签页未连接导航脚本";
    detail.textContent = "请在 ChatGPT 对话页打开此窗口。如果已经是 ChatGPT，请先刷新插件，再刷新网页，并检查插件的网站访问权限。";
  } finally {
    rescan.disabled = false;
  }
}

rescan.addEventListener("click", checkStatus);
checkStatus();
