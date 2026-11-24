<img src="/public/cover.jpg" alt="Nim 个人网站封面图" width="100%" />

Nim 是一个面向个人创作、视觉展示与长期内容沉淀的 Next.js 个人网站，基于 React、Tailwind CSS、Motion、Drizzle ORM（SQLite）与 Better Auth 构建。网站内容由本地 SQLite 数据库和本地媒体目录统一持久化管理，支持在线撰写、修订追溯、图片库与画廊展示、首页独立策展以及跨内容站内搜索。

## 核心能力

- **写作与版本体系（Blog）**：支持 `/admin` 后台在线写作、Markdown / GFM 渲染、代码高亮、目录导航，以及正文图片就地预览；本地浏览器（IndexedDB）持续保存离线恢复副本，服务端保存完整修订快照、版本对比与历史恢复，草稿与已发布版本严格隔离。
- **画廊与灯箱（Gallery）**：支持 `/gallery` 全量作品页（保留原图比例）、键盘 `←` / `→` / `Esc` 灯箱预览、`/gallery/[id]` 独立分享页（自动纳入 `sitemap.xml`），以及 `/admin/gallery` 上传、选图、说明与上下架管理。
- **独立媒体库（Media）**：上传图片自动校验像素并转码为无源元数据的 WebP；未发布内容引用的图片仅管理员可读，`/admin/media` 汇总文章与画廊引用关系并保护被引用资源不被误删。
- **首页独立策展（Homepage Curation）**：通过 `/admin/home` 独立控制首页 Writing / Gallery / Selected Projects / Work Experience 各区块的显隐、顺序、上限与条目级手动精选或自动最新模式。
- **跨内容站内搜索（Search）**：提供页头 `Ctrl/Cmd + K` 快捷检索弹窗与独立 `/search` 页面，同时检索已发布文章与画廊作品，支持中英文混排、短中文词、英文标点词及高亮摘要。

## 快速开始

使用 **Node.js 24.x 或更高版本**，详细环境变量、GitHub OAuth 与生产部署说明请参阅 [安装指南](./INSTALLATION.md)。

```bash
git clone https://github.com/IsQuyet/nim.git
cd nim
npm ci
cp .env.example .env.local
npm run dev
```

`npm run dev` 会自动执行前置初始化（`npm run setup`），创建本地数据库 `.data/nim.sqlite`、执行 `./drizzle` 迁移并生成会话密钥。启动后访问 [http://localhost:3000](http://localhost:3000)。

- 如需将 `content/blog/` 下的示例或已有文章批量导入数据库并发布，可显式执行 `npm run db:import`。
- 开发模式下如需登录 `/admin` 后台，请先按 [安装指南](./INSTALLATION.md) 在 `.env.local` 配置 GitHub OAuth 环境变量。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run setup` | 初始化 SQLite 数据库、执行 Drizzle 迁移并准备会话密钥（传入 `-- --production` 读取生产环境配置） |
| `npm run db:import` | 将 `content/blog/` 中登记的文章批量导入为已发布状态 |
| `npm run db:post-file -- import <file>` | 将本地 Markdown 文件按 front matter 中的 `id` 显式导入为草稿 |
| `npm run db:post-file -- export <postId> <output>` | 导出指定文章为 UTF-8 Markdown 文件（支持 `--published`、`--overwrite`） |
| `npm run db:generate` | 根据 `modules/*/server/schema.ts` 生成新的 Drizzle SQLite 迁移 |
| `npm test` / `npm run lint` / `npm run check-types` | 运行 Vitest 单元测试、ESLint 边界与样式规范检查、TypeScript 类型校验 |
| `npm run test:e2e` | 运行生产构建并执行 Playwright 端到端测试（需设置 `SITE_URL`） |

## 部署说明

本站点以**单机 VPS + 本地持久化目录**为目标架构，依赖本地 SQLite（WAL 模式）、持久化媒体目录 `media/` 与自动生成的 `auth-secret`。不建议直接部署到无本地持久卷的无服务器（Serverless）临时容器环境。

正式构建与启动前必须配置 `SITE_URL`、GitHub OAuth 参数与管理员 ID，并使用反代（Nginx / Caddy）配合进程管理器运行；具体操作见 [安装指南](./INSTALLATION.md)。
