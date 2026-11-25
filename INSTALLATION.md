# Nim - 安装与部署指南

## 前置条件

- **Node.js 24.x 或更高版本**（图像处理使用 `sharp`）
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
   | `DATABASE_URL` | 可选（生产/Serverless 推荐） | PostgreSQL 连接字符串（`postgres://...` 或 `postgresql://...`）。留空时本地/单机使用嵌入式 `@electric-sql/pglite` 目录。 |
   | `DATABASE_PATH` | 可选，默认 `.data/pgdata` | 仅在未设置 `DATABASE_URL` 时生效，指定本地 PGlite 数据目录路径。 |
   | `DATA_DIR` | 可选，默认取 `dirname(DATABASE_PATH)` | 持久化工作目录，用于保存本地媒体文件 `media/` 与自动生成的 `auth-secret`。 |
   | `AUTH_SECRET` | 无服务器环境必填；单机留空自动生成 | Better Auth 会话签名密钥。配置后优先于本地 `auth-secret` 文件。 |
   | `GITHUB_CLIENT_ID` | 登录后台必填 | GitHub OAuth App 的 Client ID。 |
   | `GITHUB_CLIENT_SECRET` | 登录后台必填 | GitHub OAuth App 的 Client Secret。 |
   | `ADMIN_GITHUB_ID` | 登录后台必填 | 唯一管理员的 **GitHub 数字账号 ID**（不是用户名，也不是上面的 Client ID）。 |
   | `S3_BUCKET` | 使用对象存储时必填 | 设置后自动启用 S3 / Cloudflare R2 / MinIO 媒体后端；留空则使用本地 `DATA_DIR/media/`。 |
   | `S3_REGION` | 可选，默认 `auto` | S3 Region（Cloudflare R2 填写 `auto`）。 |
   | `S3_ENDPOINT` | R2 / MinIO 等自定义兼容服务必填 | S3 兼容服务 Endpoint（例如 `https://<accountid>.r2.cloudflarestorage.com`）。 |
   | `S3_ACCESS_KEY_ID` | 设置 `S3_BUCKET` 时必填 | 对象存储 Access Key ID。 |
   | `S3_SECRET_ACCESS_KEY` | 设置 `S3_BUCKET` 时必填 | 对象存储 Secret Access Key。 |
   | `S3_KEY_PREFIX` | 可选，默认 `media` | 对象存储键前缀，最终对象路径为 `<prefix>/<id>.<ext>`。 |
   | `S3_FORCE_PATH_STYLE` | 可选，默认 `false` | 设为 `true` 可强制使用路径风格寻址（部分自建 MinIO 需要）。 |

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

   `predev` 钩子会自动执行 `npm run setup`，完成建库、执行 `./drizzle` 下所有 PostgreSQL 迁移并准备会话密钥。访问 `http://localhost:3000` 即可浏览站点。

5. **调整站点静态资料**

   个人简介、社交链接、静态项目展示（Selected Projects）与工作经历（Work Experience）位于 [modules/site/data.ts](./modules/site/data.ts)，可按需替换占位内容；区块顺序、显示开关及动态精选条目无需改代码，在登录 `/admin/home` 后直接配置。

---

## 数据持久化、迁移与导入

### 1. 数据库与目录结构

- **远程 / 容器化 PostgreSQL 模式**（设置 `DATABASE_URL`）：业务与认证数据全部存储在目标 PostgreSQL 实例；若同时配置 `S3_BUCKET` 与 `AUTH_SECRET`，容器/函数节点自身完全无状态。
- **零依赖单机模式**（留空 `DATABASE_URL`）：数据统一落地在 `DATA_DIR`（默认为 `.data/`）：

```text
<持久化目录>/
├── pgdata/           # 嵌入式 PostgreSQL（PGlite）数据目录
├── auth-secret       # 首次初始化自动生成的 Better Auth 会话签名密钥
└── media/            # 经过校验与 WebP 转码后的站内媒体文件
```

- **Drizzle 迁移**：数据库表结构定义于 `modules/*/server/schema.ts`。更新代码后运行 `npm run setup`（生产使用 `npm run setup -- --production`）会按 `./drizzle` 顺序应用增量 PostgreSQL 迁移。`npm run dev` 与 `npm start` 都会通过 `predev` / `prestart` 自动触发该脚本。

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
  针对生产数据库执行时，在末尾追加 `--production` 或提前设置 `NODE_ENV=production` 与 `DATABASE_URL` / `DATABASE_PATH`。
- **后台界面导入**：登录管理员后访问 `/admin/import` 上传 `.md` / `.markdown` 文件。

---

## 方案 A：单机 VPS 部署（Docker Compose 或裸机）

### Docker Compose（推荐 VPS 方案）

仓库自带 [Dockerfile](./Dockerfile) 与 [compose.yaml](./compose.yaml)（PostgreSQL 17 + Nim）：

```bash
cp .env.example .env
# 编辑 .env，填写 SITE_URL、GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、ADMIN_GITHUB_ID、AUTH_SECRET 等
docker compose up -d --build
```

### 裸机 Node.js + 反向代理

1. 在 `.env.production.local` 或系统环境中配置 `SITE_URL`（以及可选 `DATABASE_URL` / `DATABASE_PATH`、`GITHUB_*`、`ADMIN_GITHUB_ID`）。
2. 校验与构建：
   ```bash
   npm ci
   npm test
   npm run lint
   npm run check-types
   npm run build
   ```
3. 启动服务：
   ```bash
   npm start -- --hostname 127.0.0.1 --port 3000
   ```
   建议使用 `systemd` 或 `pm2` 守护进程，由 Nginx / Caddy 在前端终止 HTTPS 后反代至 `127.0.0.1:3000`（需透传 `Host`、`X-Forwarded-Proto` 与 `X-Forwarded-Host` 请求头）。

---

## 方案 B：Vercel + 托管 PostgreSQL + 对象存储部署（无服务器）

仓库已自带 [vercel.json](./vercel.json)，会在 Vercel 每次构建时自动执行 `npx tsx scripts/setup.ts --production && npm run build` 完成 Drizzle PostgreSQL 迁移，并自动识别 `VERCEL_PROJECT_PRODUCTION_URL` 与 `VERCEL_URL` 作为站点根地址（无需提前猜填 `SITE_URL`）。

### 第一步：先一键部署上线（仅需 PostgreSQL）

1. 点击 [README](./README.md) 中的 **Deploy with Vercel** 按钮（或直接在 Vercel 控制台 Import 仓库并在 **Storage / Marketplace** 添加一个免费 **Neon PostgreSQL** 集成，会自动注入 `DATABASE_URL`）。
2. 直接点击部署即可成功访问公开站点（如果后续在 Vercel 绑定自定义域名，`SITE_URL` 也会随正式域名自动生效；只有希望强制锁定固定域名时才需手动设 `SITE_URL`）。此时留空 GitHub OAuth、`AUTH_SECRET` 与 `S3_*` **完全不会阻塞部署或公开页面访问**，`/admin/login` 会安全提示尚未配置管理员登录。

### 第二步：按需开启 `/admin` 后台登录

1. 拿到第一步的线上地址（例如 `https://your-site.vercel.app`）后，在 GitHub Developer Settings 创建一个 OAuth App，将回调地址设为：
   `https://your-site.vercel.app/api/auth/callback/github`
2. 在 Vercel 项目 **Settings -> Environment Variables** 中补充：
   - `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`ADMIN_GITHUB_ID`
   - `AUTH_SECRET`（全平台通用生成命令：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`）
3. 触发一次 Redeploy，即可通过 `/admin` 登录后台在线写作与发布。

### 第三步：按需开启图片上传与画廊（任意 S3 兼容对象存储）

仅需在需要在线上传图片时配置；不配置不影响浏览公开页面和纯文本文章撰写。支持 Cloudflare R2、AWS S3、MinIO 等标准 S3 协议私有桶（站点通过 `/media/[id]` 校验草稿/发布权限后再转发图像字节，无需开启桶的公开访问）：
- `S3_BUCKET`、`S3_REGION`（R2 填 `auto`）、`S3_ENDPOINT`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`
- 在 Vercel Serverless Functions 环境下，受平台单次请求体上限约束，单张图片建议控制在 **4.5 MB** 以内（自托管 VPS/Docker 上限为 `10 MB`）。
