# Nim - 安装指南

## 前置条件

- Node.js 24.x 或更高版本
- Git

## 安装步骤

1. **克隆仓库**

   ```bash
   git clone https://github.com/IsQuyet/nim.git
   cd nim
   ```

2. **安装依赖**

   ```bash
   npm ci
   ```

3. **启动开发服务器**

   ```bash
   npm run dev
   ```

   默认访问 `http://localhost:3000`，本地开发不需要先配置域名。

4. **修改站点资料**

   站点信息与个人资料分别维护。初次使用时，可在 `app/data.ts` 中按需替换网站介绍、个人简介、项目、经历和联系方式的占位内容。

5. **内容与发布方式**

正文采用 Markdown，不把文章作为可执行源码。在线创作与发布是演进方向，当前内容仍通过仓库维护，更新正式站点需要重新构建和部署。

6. **项目结构**

如需进一步了解 Next.js 的项目结构，请参阅 [Next.js](https://nextjs.org/docs/app/getting-started/project-structure) 文档。

7. **更多功能**

想添加更多动画组件吗？
可以查看 [Motion-Primitives](https://motion-primitives.com/)，了解更多动画组件和模板。如需联系模板原作者，可以通过 [X](https://x.com/Ibelick) 发送私信。

8.  **部署**

正式运行需要先构建，再启动生产服务器，不使用 `npm run dev` 对外提供服务。

构建前，通过部署环境变量或仓库根目录下不入库的 `.env.production.local` 设置站点地址：

```dotenv
SITE_URL=https://example.com
```

填写实际公开的 HTTP 或 HTTPS 站点根地址。生产构建必须提供该变量，开发模式不填时默认使用 `http://localhost:3000`。

在仓库根目录依次执行：

```bash
npm test
npm run lint
npm run check-types
npm run build
npm start -- --hostname 127.0.0.1 --port 3000
```

上述启动命令只监听本机回环地址。在 VPS 上，由 Nginx 或 Caddy 等反向代理提供公开域名与 HTTPS，再转发到这个端口。常驻进程交给进程管理器维护，避免退出终端后服务停止。

`SITE_URL` 应与部署入口的公开地址一致，但不会配置 DNS、改变监听端口或申请证书。公开网址会在构建时写入产物，更换域名后需要重新构建，再重启服务。

若使用 Vercel，在项目环境变量中设置 `SITE_URL`，让它在构建时生效。以下按钮基于当前仓库创建部署项目：

[![使用 Vercel 部署](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FIsQuyet%2Fnim&env=SITE_URL&project-name=nim&repository-name=nim)
