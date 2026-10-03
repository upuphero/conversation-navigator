# Conversation Navigator · 对话导航

用于 **ChatGPT 网页版**的 Chrome 插件。右侧的一列短横杠按顺序对应你的提问。

当前版本 **0.1.4（开发版）**。本地浏览器测试不代表已在你的实际 ChatGPT 会话中验证。

- **鼠标悬停**：显示问题原文和序号；长问题可在预览卡片里滚动。
- **点击横杠**：按回合 ID 定位对应回答；回答尚未出现时，跳到提问。消息临时卸载时，先定位保留的回合容器，等待内容加载并重新查找目标，最多等待 2.5 秒。
- **滚动对话**：高亮当前回答对应的横杠，并显示 `当前位置 / 问题总数`。
- 支持底部锚定的反向聊天布局：保留负数滚动位置，避免每次点击都被强制拉到底部。
- 新增提问、修改提问、重新生成回答、切换会话时自动更新。
- 适配深色和浅色模式；问题较多时，可用鼠标滚轮滚动导航列。
- 键盘 Tab 聚焦横杠，↑ / ↓、Home / End 切换，Enter 跳转，Esc 收起预览。

## 安装

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 打开右上角的 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择这个文件夹：`C:\Coding\Extension\conversation-navigator`。
5. 打开或刷新 [ChatGPT](https://chatgpt.com/)，进入一个已有对话。

无需安装依赖或构建。修改插件文件后，在扩展管理页点击插件的刷新按钮，再刷新 ChatGPT 页面。

## 范围和隐私

只在 `chatgpt.com` 和 `chat.openai.com` 运行，只读取页面中已经加载的消息。没有网络请求，不保存或上传对话，不需要 API Key。

兼容旧版角色标记、新版分组消息气泡及 `data-turn` 结构。已经读取过的问题会在当前会话中保留文本，只要对应回合容器还在，就可以继续导航；从未加载、且没有任何回合容器的消息无法凭空列出。切换会话后清空缓存。ChatGPT 调整消息的 DOM 标记后，仍可能需要更新 `content.js` 中的选择器。

## 刷新后没有导航

1. 在 `chrome://extensions` 点击此插件卡片的 **↻**，确认版本为 **0.1.4**。
2. 回到 ChatGPT 的已有对话页，再刷新网页。更新本地文件后，只刷新网页不会让 Chrome 重新加载插件文件。
3. 点击 Chrome 工具栏的拼图图标，再点 **Conversation Navigator · 对话导航**，查看运行状态。
4. 状态为“当前标签页未连接导航脚本”时，检查扩展详情中的网站访问设置是否允许在 ChatGPT 上运行；状态为“暂未识别到问题”时，可以点击“重新检查并扫描”。

如果识别到了问题但点击不跳转，点击一次横杠后打开状态窗口，查看“已收到导航点击”以及“上次点击”的定位结果、滚动位置变化和滚动区域。这些信息可以区分点击未触发、目标未渲染、滚动被中断和定位失败。定位失败时，问题卡片也会显示提示。

状态窗口只检查插件版本、消息数量及本地跳转几何信息，不显示或传输问题内容，不增加插件权限。

## 开发验证

在此目录运行：

```powershell
npm run check
npm test
```

浏览器测试使用 Node.js 22+ 内置功能和本机 Chrome，在临时独立浏览器配置下验证模拟聊天页面。跳转回归测试使用浏览器鼠标事件，检查实际滚动位置和回答在视口内的位置；覆盖页面拦截点击、回合 ID 下的节点替换、延迟挂载、顶部栏遮挡和不同滚动区域。可以通过环境变量 `CHROME_PATH` 指定浏览器程序路径。截图保存到 `tests/artifacts/navigator.png`。

反向滚动回归测试先复现了旧代码将 `-500` 强制改为 `0` 的失败，再验证多个较早回答各自正确定位、最后一个回答回到底部，以及切回普通滚动布局后的行为。负数滚动位置的标准行为见 [MDN scrollTop 文档](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTop)。

回合建模和直接计算容器滚动位置的设计参考 [NavGPT 消息模型](https://github.com/LaSav/navgpt/blob/main/extension/src/dom/scrape.ts)及 [NavGPT 滚动实现](https://github.com/LaSav/navgpt/blob/main/extension/src/dom/scroll.ts)。插件仍使用原生 JavaScript，无需构建。

扩展结构和加载方式参考 [Chrome content scripts 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)及 [Chrome 本地加载扩展教程](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)。
