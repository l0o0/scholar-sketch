# 发布前维护功能说明

升级 `package.json` 的版本时，同时更新 `src/modules/release-highlights.ts`：

1. 为新版本增加一条记录，选择本次值得用户了解的功能。纯修复版本也可以使用空的 `features` 列表，保留完整更新日志入口。
2. 每个功能通过 `title` 和 `body` 引用 Fluent 文案键；新功能在中英文 `addon.ftl` 中增加对应的 `feature-updates-<标识>-title` 和 `-body`。文案应说明用户可以做什么、从哪里开始。
3. 只有包含旧功能的首次导览才标记 `overview: true`；正常版本使用「本次更新」。同步更新中文指南 `docs/user-guide.md` 和英文指南 `docs/user-guide.en.md` 中受影响的操作说明，并向 Zotero 中文 Wiki 提交中文指南的修改。
4. 运行 `pnpm run test:unit` 和 `pnpm run build`。发布工作流也会执行 `test/release-highlights.test.ts`，缺少当前版本记录或翻译时停止发布。

更新卡片随插件打包，不从服务器拉取推送内容。自动提示仅在 Markdown 或 Canvas 加载成功、窗口获得焦点且文档可见时展示；后台恢复标签页时暂停提示。`featureUpdatesSeenVersion` 记录当前 Zotero 配置中已经展示的版本，MD、Canvas 和独立窗口共用该记录。提示不自动移动编辑器焦点，用户可在 Zotero 设置的 Scholar Sketch 页面中点击「本次更新」重看。

使用指南的目标地址为 Zotero 中文 Wiki 的 `/user-guide/plugins/scholar-sketch`。在用户点击指南时检查页面是否可用；尚未上线或暂时不可达时，打开 GitHub 中已发布的文档快照（Wiki PR #475 的提交）。检查不在编辑器启动时执行，也不发送笔记、文库或使用记录。Wiki 主线合并部署后，入口会使用正式页面。

后续更新指南时，一并维护 `src/modules/help.ts` 中的备用快照地址，确保它指向已推送、可公开访问且内容对应的提交，不要指向尚未发布的本地文件。

仓库 README 提供中英文完整指南入口。应用内指南入口目前仍使用上述中文地址；英文指南发布到仓库后，才可接入按语言选择的帮助入口。向 Wiki 同步中文指南时，将语言切换链接调整为 Wiki 中文页面和已发布的 GitHub 英文指南地址，避免沿用只在本仓库有效的相对路径。
