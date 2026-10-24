# 候选构建与人工发布

CI 自动验证和打包，维护者决定发行。推送 `v*` tag 不再触发正式发布；`pnpm release` 只允许在人工触发的 GitHub Actions 发布任务内执行。禁止用旧的 `zotero-plugin release` 推广候选：当前 scaffold 会再次构建，使发布包不再等于已检查的候选。

## 生成和检查候选

1. 在普通 PR 中更新 `package.json` 的版本、README 的版本示例及 `src/modules/release-highlights.ts`。版本格式为 `major.minor.patch`，可带 `-beta.1` 等预发布标识；不支持 `+build` 后缀。先合并通过审核的变更。
2. `main` 的 push CI 完成全部检查后，在该 run 下载 `scholar-sketch-candidate-<run-id>-<attempt>`。PR CI 也产生可预览候选，但不能推广。不要只看 build job 成功，整个 CI run 必须成功。
3. 候选包含原始 XPI、更新清单和 `candidate.json`。后者记录完整 commit、版本、仓库、CI run/attempt 以及每个文件的 SHA512。产物保留 14 天；过期后重新构建并检查新的候选。
4. 在真实 Zotero 中安装候选 XPI，按改动范围检查启动、相关功能、保存重开或关闭卸载等实际行为。记录 Zotero/操作系统版本、检查动作、结果和限制。fake 环境通过不能替代宿主检查，也不要为了发行声称未执行的检查已经通过。

构建脚本仍使用 scaffold；`node scripts/release-candidate.mjs create` 在构建后验证 ZIP 内插件 ID、版本、更新地址、兼容范围及清单中的 SHA512，再保存候选。推广阶段不会安装依赖或重新构建。

## 人工推广

打开 Actions → **Promote release candidate** → **Run workflow**，分支选 `main`，填写：

- `candidate_run_id`：候选所属的成功 CI run ID。
- `expected_sha`：人工检查的候选完整 40 位 commit SHA。
- `expected_xpi_sha512`：从已检查候选的 `candidate.json` 复制 XPI 的 `sha512:...` 值。同一 run 重跑也可能改变构建字节，仅填写 commit 不足以绑定实际检查的包。
- `version`：精确版本，不含 `v`。
- `host_evidence`：该候选的真实 Zotero 检查记录，可附长期记录链接。

人工填写宿主记录是一项维护者声明，脚本不会把它伪装成自动测试。工作流核对 GitHub 提供的 run、仓库、CI workflow、main push、完整结论和 commit，再验证该 attempt 的候选与对应源码版本。输入通过环境变量传递，不拼接成 shell 代码。

验证通过后，工作流创建指向同一 commit 的版本 tag 和 draft release，上传原始 XPI，下载复核 SHA512，再公开该版本，最后更新浮动 `release` 中的更新清单。发布说明记录候选 run、commit、SHA512 和宿主检查记录。不会自动给 issue 或 PR 发评论，也不依赖 `GITHUB_TOKEN` 推 tag 后再次触发 workflow。

正式 XPI 名称仍为 `scholarsketch-v<version>.xpi`；插件 ID、版本下载地址和 `release/update.json`、`release/update-beta.json` 地址保持兼容。稳定版更新两个通道，预发布只更新 beta。旧清单中的历史兼容条目及其他插件条目会保留。候选版本低于任一待更新通道中的现有版本会被拒绝；例如 beta 已到 `0.3.0-beta.1` 时，不会用 `0.2.15` 覆盖 beta，需要先调整发行顺序或另行审核通道策略。

## 失败与重试

不同版本的推广共用一个 concurrency group，避免这套工作流并发修改通道。但 GitHub release assets 不支持两个文件的原子替换，也无法约束工作流之外的手工修改；不要同时手工改 tag 或通道。

所有通道校验和备份发生在远端写入之前。每次推广保留 `release-channel-backup-<run-id>-<attempt>` artifact，包含原始清单字节及推广记录，保留 90 天。

- tag 已存在时必须指向候选 commit；正式 XPI 已存在时必须与候选字节匹配。工作流不会覆盖版本包、重建候选或移动既有 tag。
- XPI 上传或复核失败时，更新通道不变，可能留下 tag 或 draft。用同一候选重试即可继续；不得另造同版本的新包覆盖。
- 重试通过发布列表寻找唯一匹配的 draft，并按 release ID 上传；发现同一 tag 对应多个 release 时停止，交由维护者处理，不猜测该使用哪一个。
- 如果候选检查期间 `main` 的 `.github/workflows/` 已改变，GitHub 可能因旧候选与默认分支的 workflow 差异拒绝创建 tag/release（403 或 404）。`GITHUB_TOKEN` 不能获得所需的 Workflows 写权限；此流程不会自动扩展 token 权限。维护者应先核对权限原因、候选 SHA 和既有远端状态，再用自己的权限处理匹配的 tag/draft 后重试，或从新的 main 候选重新检查。14 天保留期不保证旧候选都能直接创建发行。
- 通道上传或复核失败时，工作流尝试逐一恢复受影响清单的原始字节。版本 release 此时可能已经公开，失败信息会明确指出这一点。
- 若出现 `RESTORE FAILED`，停止后续推广，从备份 artifact 取出旧清单，由维护者恢复浮动 `release` 的对应资产并下载核对。不要删除正式版本或假装发行已完整成功。
- 恢复后的重试仍须使用相同 tag、commit 和候选字节。旧版本退回属于新的发行决策，应采用更高版本号的修复包；此工作流拒绝通道降级。

此设计使用有写权限的维护者手动 dispatch。若仓库另外设置 environment 的 required reviewers，可以增加双人审批；未配置这些仓库设置时，不能声称已强制执行双人审批。

## 验证发布工程本身

运行 `node --import tsx --test test/release-candidate.test.ts test/release-config.test.ts`。测试使用真实本地 ZIP fixture 和 GitHub stub，覆盖内容篡改、错误来源、commit/版本不一致、通道降级、相同字节重试及通道失败恢复；不会调用真实发布写接口。第一次正式发行仍需维护者手动执行并检查 GitHub 上的实际产物，不能把本地 stub 通过表述为线上发行已验证。
