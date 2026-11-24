# Nim - 安装与部署指南

## 前置条件

- **Node.js 24.x 或更高版本**（仓库自带原生依赖 `better-sqlite3` 与 `sharp`）
- **Git**
- **GitHub OAuth App**（用于 `/admin` 单管理员登录授权；仅本地预览公开页面可先留空）

---

## 本地开发配置

1. **克隆仓库并安装依赖**

   ```bash
   git clone https://github.com/IsQuyet/nim.git
   cd nim
   npm ci
   ```

2. **配置环境变量**

   复制示例配置到 `.env.local`（不入库）：

   ```bash
   cp .env.example .env.local
   ```

   各变量说明如下（参考 [.env.example](./.env.example)）：

   | 变量名 | 必填范围 | 说明 |
   | --- | --- | --- |
   | `SITE_URL` | **生产构建必填**；本地留空默认 `http://localhost:3000` | 必须是完整的 HTTP 或 HTTPS 站点根地址（例如 `https://example.com`），不能带子路径、查询参数、片段或认证信息。 |
   | `DATABASE_PATH` | 可选，默认 `.data/nim.sqlite` | SQLite 数据库文件路径。自动生成的会话密钥 `auth-secret` 与上传媒体目录 `media/` 会存放在同一父目录下。 |
   | `GITHUB_CLIENT_ID` | 登录后台必填 | GitHub OAuth App 的 Client ID。 |
   | `GITHUB_CLIENT_SECRET` | 登录后台必填 | GitHub OAuth App 的 Client Secret。 |
   | `ADMIN_GITHUB_ID` | 登录后台必填 | 唯一管理员的 **GitHub 数字账号 ID**（不是用户名，也不是上面的 Client ID）。 |

3. **配置 GitHub OAuth 回调地址**

   在 GitHub Settings → Developer settings → OAuth Apps 中创建应用：
   - **Homepage URL**：填写你的站点根地址（本地开发为 `http://localhost:3000`，生产环境为 `SITE_URL`）。
   - **Authorization callback URL**：必须填写为：
     ```text
     <SITE_URL>/api/auth/callback/github
     ```
     例如本地开发填写 `http://localhost:3000/api/auth/callback/github`，正式站填写 `https://example.com/api/auth/callback/github`。
   - **获取数字账号 ID**：可通过 `https://api.github.com/users/<你的用户名>` 返回 JSON 中的 `id` 字段获取数字 ID，填入 `ADMIN_GITHUB_ID`。

4. **启动开发服务器**

   ```bash
   npm run dev
   ```

   `predev` 钩子会自动执行 `npm run setup`，完成 SQLite 建库、执行 `./drizzle` 下所有待应用迁移并创建 `auth-secret`。访问 `http://localhost:3000` 即可浏览站点。

5. **调整站点静态资料**

   个人简介、社交链接、静态项目展示（Selected Projects）与工作经历（Work Experience）位于 [modules/site/data.ts](./modules/site/data.ts)，可按需替换占位内容；区块顺序、显示开关及动态精选条目无需改代码，在登录 `/admin/home` 后直接配置。

---

## 数据持久化、迁移与导入

### 1. SQLite 与目录结构

数据统一落地在 `dirname(DATABASE_PATH)` 下（本地默认为 `.data/`）：

```text
<持久化目录>/
├── nim.sqlite        # 业务与认证数据（开启 WAL 与外键约束）
├── auth-secret       # 首次初始化自动生成的 Better Auth 会话签名密钥
└── media/            # 经过校验与 WebP 转码后的站内媒体文件
```

- **Drizzle 迁移**：数据库表结构定义于 `modules/*/server/schema.ts`。更新代码后运行 `npm run setup`（生产使用 `npm run setup -- --production`）会按 `./drizzle` 顺序应用增量迁移。`npm run dev` 与 `npm start` 都会通过 `predev` / `prestart` 自动触发该脚本。
- **备份原则**：只要完整保留与备份该持久化目录，更新代码重新部署就不会丢失文章、修订历史、画廊、媒体文件或已有管理员会话密钥。

### 2. 显式导入已有 Markdown 文章

仓库内置的 `content/blog/` 不会自动混入数据库，避免开发与生产环境悄悄产生隐式数据。如需导入可通过以下两种显式途径：

- **批量导入内置文章并发布**（已存在的文章 ID 会自动跳过）：
  ```bash
  npm run db:import
  ```
- **命令行导入/导出单个 Markdown 文件**（以 front matter 中的 `id` 为文章 UUID，不以文件名定位；导入只更新草稿，不直接发布）：
  ```bash
  npm run db:post-file -- import ./path/to/article.md
  npm run db:post-file -- export <postId> ./out/article.md --published
  ```
  针对生产数据库执行时，在末尾追加 `--production` 或提前设置 `NODE_ENV=production` 与 `DATABASE_PATH`。
- **后台界面导入**：登录管理员后访问 `/admin/import` 上传 `.md` / `.markdown` 文件。

---

## 单机 VPS 生产部署

正式环境禁止使用 `npm run dev` 对外提供服务，应使用生产构建 + 本地持久化目录 + 反向代理：

1. **准备生产环境变量**

   在部署环境或仓库根目录不入库的 `.env.production.local` 中配置完整变量，例如：

   ```dotenv
   SITE_URL=https://example.com
   DATABASE_PATH=/var/lib/nim/nim.sqlite
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ADMIN_GITHUB_ID=...
   ```

   请确保运行 Node 进程的系统用户对 `DATABASE_PATH` 所在目录（例如 `/var/lib/nim`）拥有读写权限，且该目录在更新发布代码时保持不变。

2. **校验并构建产物**

   ```bash
   npm ci
   npm test
   npm run lint
   npm run check-types
   npm run build
   ```

   > 注意：`SITE_URL` 会在构建时参与静态元数据、`sitemap.xml` 与 `robots.txt` 生成；若更换公开域名，需修改 `SITE_URL` 后重新执行 `npm run build` 并重启服务，同时同步更新 GitHub OAuth App 的回调地址。

3. **启动服务与反向代理**

   ```bash
   npm start -- --hostname 127.0.0.1 --port 3000
   ```

   `prestart` 会自动先执行 `npm run setup -- --production` 完成 SQLite 迁移。建议使用 `systemd`、`pm2` 等进程管理器守护该进程，并由 Nginx 或 Caddy 在前端终止 HTTPS 后反向代理至 `127.0.0.1:3000`（需透传 `Host`、`X-Forwarded-Proto` 与 `X-Forwarded-Host` 请求头，确保 Better Auth OAuth 回调校验与公开 URL 一致）。
