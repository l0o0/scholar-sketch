# 论文写作试用样稿

本示例验证 Markdown → Pandoc → Word 的真实转换。`manuscript.md` 含中文、正式引文、行内与独立公式、普通表格、HTML 图片、脚注；`references.json` 是示例文献的 CSL 数据，不读取用户文库；`reference.docx` 是可选的示例 Word 样式模板。

在已安装 Pandoc 的环境执行：

```sh
node --import tsx scripts/paper-export-smoke.ts
```

可用 `PANDOC_PATH` 指定程序路径，或传入输出目录作为第一个参数。默认输出 `.scaffold/paper-smoke/manuscript.docx`。脚本调用生产转换实现，只替换宿主文件、进程与文献访问边界；不验证 Zotero 的原生窗口、文件选择器或 Word 插件动态引文。

插件内试用时，使用“更多 → 插入文献引用…”选择自己的文献，替换样稿的示例引用。不要在真实文库中假定存在 `PANDOC01` 条目。之后选择“更多 → 导出 → Word 文档…”，指定 Pandoc、Zotero 引文样式及可选模板。

Word 中的引文为静态排版结果。请在 Markdown 中维护引用并重新导出；该版本不生成 Zotero Word 插件字段，也不从 Word 双向同步修改。示例模板仅演示样式映射，不代表任何学校或期刊的格式要求。
