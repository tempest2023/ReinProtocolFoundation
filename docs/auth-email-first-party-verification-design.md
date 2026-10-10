# 管理员邮件登录技术设计

更新：2026-10-10。此版本替代最初“打开链接后再点击确认”和“同封邮件提供链接及验证码”的交互设计。

## 1. 产品决策

- 管理员登录提供两种独立方式：默认邮件链接，也可在发送前选择验证码。
- 邮件链接发送后，隐藏邮箱输入和发送按钮，显示“请查看邮箱”、提交地址及邮件内登录指引。
- 验证码发送后，直接显示 8 位验证码输入框，不再要求填写邮箱或选择操作类型。
- 邮件内容互斥：链接邮件只有登录按钮及同地址的复制链接；验证码邮件只有验证码和无凭据的输入页入口。
- 邮件链接与验证码有效期均为 **7200 秒（2 小时）**，一次性使用。重发等待 60 秒，提示使用最新邮件。
- 打开完整 Magic Link 后自动验证、建立浏览器会话并跳转后台，无需二次确认。
- 页面延续现有品牌和中英文切换，卡片最大宽度 40rem。常规状态在 1280×720 桌面视口中完整可见；手机和放大文字允许自然滚动。

## 2. 发送入口与邮件渲染

`requestAdminLink` 接收邮箱及 `method: 'magic-link' | 'code'`；缺省方法保持链接兼容。校验重复字段、邮箱和枚举后，执行现有限流及管理员资格检查。

生产仍调用 publishable SSR client 的 `signInWithOtp`，固定 `emailRedirectTo`：

| 所选方式 | 固定地址 | 发送后的页面 |
| --- | --- | --- |
| 邮件链接 | `${SiteURL}/auth/confirm` | 提示去邮箱点击链接，不再展示邮箱输入 |
| 验证码 | `${SiteURL}/auth/code` | 直接显示验证码输入，邮箱保留在组件状态 |

confirmation 和 magic_link 模板使用 Go Templates，根据 `.RedirectTo` 与 `.SiteURL` 拼出的固定地址比较后选择主题及内容。不得将 `.RedirectTo` 直接作为邮件中的行动链接，也不使用用户 metadata 决定授权或发送方式。

- 选择 `/auth/code`：发送 code-only 变体。
- 选择 `/auth/confirm`：发送管理员 link-only 变体，包括尚未确认邮箱的首次管理员登录。
- 其他入口：保留对应模板的原始邮箱确认或登录目的，但只提供链接。

Magic Link 按钮与复制链接完全一致：

```text
${SiteURL}/auth/confirm#token_hash=${TokenHash}&flow=admin-signin
```

普通邮箱确认使用 `flow=confirm-email`。验证码邮件提供不含凭据的 `${SiteURL}/auth/code` 入口，支持在其他设备输入邮箱及验证码。

不引入 Send Email Hook 或生产 `admin.generateLink`，沿用 Supabase → Resend SMTP。其余四类 Auth 邮件及 Contributor 业务验证保持原有职责。

发送结果统一处理未授权地址和提供商失败，避免枚举管理员。状态返回的邮箱仅是本次提交值，不代表该邮箱已验证、已获授权或已投递。重发仍受共享数据库限流与 Supabase 冷却保护；重发失败保留当前输入状态。

## 3. 验证与会话

| 路由 | 行为 |
| --- | --- |
| `/admin/login` | 选择方式、请求邮件、呈现发送后的状态或直接输入验证码 |
| `/auth/confirm` | 从 fragment 读取完整凭据，自动验证一次，显示加载或错误状态 |
| `/auth/code` | 直接呈现邮箱与验证码输入，不提供 Action 选择器 |
| `/api/auth/verify` GET | 获取或复用短期 CSRF nonce，不验证邮件凭据 |
| `/api/auth/verify` POST | 校验来源、格式、CSRF 和限流，verifyOtp 后写入全部会话 Cookie |
| `/auth/confirmed` | 使用可信 getUser 检查邮箱确认状态 |
| `/auth/callback` | 保留旧 PKCE 回调兼容 |

链接解析后立即清除 URL fragment，只在组件内存和 HTTPS POST 请求中使用凭据，不进入浏览器持久存储、分析事件或日志。GET、HEAD 和仅执行 HTTP 请求的预取仍不兑换令牌；页面 JavaScript 初始化后自动 POST。Strict Mode effect replay 不取消并重启同一次兑换。

验证码只在用户提交表单时验证；每次提交重新获取有效 CSRF nonce，避免页面打开超过十分钟后提交失败。错误验证码可修改后重试，仍受邮箱/IP 限流约束。

验证 API 的请求结构保持：

```ts
type VerificationRequest =
  | { mode: 'link'; flow: 'admin-signin' | 'confirm-email'; token_hash: string; csrf: string }
  | { mode: 'otp'; flow: 'admin-signin' | 'confirm-email'; email: string; token: string; csrf: string }
```

管理员验证成功固定跳转 `/admin`，普通邮箱确认固定跳转 `/auth/confirmed`；不接受客户端任意目标。授权继续根据已验证 user ID、环境邮箱 allowlist 或有效管理员记录判断，邮箱确认不授予管理员资格。首次管理员登录与已存在管理员登录均直接进入后台。

保留 4 KiB 请求限制、严格字段校验、同源 Origin/CSRF、防缓存、no-referrer、CSP 和完整 SSR Cookie 分块写入。验证码页纳入与链接页相同的隐私及安全响应头。

管理员浏览器使用 30 天持久会话 Cookie，关闭并重新打开浏览器仍可进入后台。访问令牌保持 3600 秒，通过代理自动刷新；刷新写入的 Cookie 同样保留 30 天。Server Action、Route Handler 和代理共用写入策略，保持退出及旧分块删除的 `Max-Age=0`。当前 SSR SDK 会覆盖 `cookieOptions.maxAge`，因此期限必须在 Cookie 实际写入时应用。

已有有效管理员会话访问 `/admin/login` 时直接进入 `/admin`。Sign Out 使用 `scope: 'local'` 撤销当前会话并删除当前浏览器 Cookie，不影响同一管理员的其他设备。线上不启用更短的会话总时长、闲置超时或单设备限制；清除浏览器 Cookie、撤销会话或移除管理员权限仍会终止访问。

## 4. 错误与默认值

- 无效、过期及已使用凭据使用统一、准确的提示，不把所有失败描述成刚刚过期；提供获取新邮件入口。
- 无管理员资格单独显示权限错误，不伪装成令牌过期。
- 429 使用 Retry-After 提示等待；不得自动重复兑换。
- 网络超时或上游故障显示结果未确认，提供检查后台登录状态和请求新邮件的入口。不能将重放失败直接视为已登录，也不能把原有会话当成本次凭据验证成功。
- 缺失或不完整的链接提示重新打开原邮件，不自动切换成验证码表单。
- 无 JavaScript 时提供启用 JavaScript 或申请验证码的说明。

配置默认值：邮箱 OTP 8 位、有效期 7200 秒；CSRF nonce 600 秒；Supabase → Resend 自定义 SMTP 全项目每小时 10 封，单邮箱重发冷却 60 秒；应用发送每 IP 每小时 10 次、每邮箱每小时 3 次；验证每 IP 每十分钟 30 次，验证码额外每邮箱每十分钟 5 次。JWT 有效期 3600 秒，浏览器会话 Cookie 为 2592000 秒，二者均与邮件凭据有效期独立。

用户要求的自动登录会替换浏览器现有账户会话；可执行 JavaScript 的邮件扫描器仍可能消费 Magic Link。验证码是独立替代方式，不声称能判断邮件访问者一定是人类。

## 5. 验证和上线

- 单元测试覆盖发送方法校验、固定回调地址、统一结果、邮件变体互斥、发送后隐藏邮箱输入、直接输入验证码、Strict Mode 仅兑换一次及每次提交获取新 nonce。
- 真实本地 Supabase/Mailpit 桌面及手机测试覆盖首次/已有管理员的渲染邮件、跨浏览器自动登录、验证码纠错、Cookie 与后台访问、无权限、凭据重放、错误输入、超时/限流和中英文切换。
- 本地时钟夹具将测试账户的邮件发送时间设为 119 分钟前与 121 分钟前，分别验证成功和拒绝，以检查两小时边界。
- 检查桌面常规状态无需滚动、手机无横向溢出，运行 lint、类型检查、构建与生成模板一致性检查。
- 上线先备份 Auth 配置，将 `mailer_otp_exp` 改为 7200、追加两个固定回调地址；发布网站后更新 confirmation/magic_link 的主题及 HTML，并读回比较。核对既有 Resend SMTP（`smtp.resend.com:465`、用户 `resend`、发件人 `noreply@rein-protocol.org`），将 `rate_limit_email_sent` 设为 10，保留管理员资格及其他模板。
- 验证 Cookie 期限、浏览器重开保持登录、代理刷新仍使用 30 天、退出清除全部分块、其他设备仍可访问，并检查后台不再接受已退出浏览器。
- 生产测试使用新邮件独立验证链接与验证码，记录脱敏结果；最后另发一封未兑换邮件供用户亲自验证，明确标注前两封已被测试使用。
