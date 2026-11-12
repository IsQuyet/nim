<img src="/public/cover.jpg" alt="Nim 个人网站模板的封面图" width="100%" />

本项目以 Nim 个人网站模板为基础，使用 Next.js、React、Tailwind CSS 和 Motion，保留简洁布局及 [Motion-Primitives](https://motion-primitives.com) 提供的动画组件，逐步形成用于记录、展示与创作的个人网站。

上游模板演示：[https://nim-fawn.vercel.app](https://nim-fawn.vercel.app)

## 定位与方向

- 博客是个人网站的组成部分，承载日常记录与内容表达。
- 正文以 Markdown 为基础，保留扩展表达的空间。
- 逐步支持在线创作、保存和发布，降低内容维护对代码提交与重新部署的依赖。
- 保持阅读页面简洁，同时允许展示页面探索视觉与交互。

## 快速开始

详细的配置步骤请参阅[安装指南](./INSTALLATION.md)。

使用 Node.js 24.x 或更高版本，在仓库根目录运行：

```bash
git clone https://github.com/IsQuyet/nim.git
cd nim
npm ci
npm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000) 查看效果。本地开发未设置 `SITE_URL` 时默认使用这个地址。

在线创作仍是演进目标，目前内容通过仓库维护并构建发布。

## 参与贡献

欢迎贡献！你可以提交 Issue 或 Pull Request，帮助改进 Nim。

## 部署

网站可以部署到支持 Next.js 服务端运行的环境。正式构建前，将 `SITE_URL` 设置为实际公开的站点根地址，例如 `https://example.com`。域名解析与 HTTPS 由部署环境配置。

VPS 可以采用反向代理配合进程管理器运行。使用 Vercel 时，在项目环境变量中提供 `SITE_URL`：

[![使用 Vercel 部署](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FIsQuyet%2Fnim&env=SITE_URL&project-name=nim&repository-name=nim)

## 关于

Nim 希望让个人品牌展示变得轻松而美观。如果你喜欢它，欢迎分享，也可以了解 [Motion-Primitives Pro](https://pro.motion-primitives.com/)。
