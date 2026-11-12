# Nim - 安装指南

## 前置条件

- Node.js 24.x 或更高版本
- Git

## 安装步骤

1. **克隆仓库**

   ```bash
   git clone https://github.com/ibelick/nim.git
   cd nim
   ```

2. **安装依赖**

   ```bash
   npm install
   ```

3. **启动开发服务器**

   ```bash
   npm run dev
   ```

4. **更新模板数据**

   修改 `app/data.ts` 文件中的模板数据。

   ```ts
   export const EMAIL = 'your@email.com'

   export const SOCIAL_LINKS = [
     {
       label: 'Github',
       link: 'your-github-url',
     },
     // Add your social links
   ]

   ...
   ```

5. **添加博客文章**

在 app/blog 文件夹中，为每篇博客文章创建一个新的 .mdx 文件。例如：
app/blog/your-article-slug/page.mdx。

.mdx 博客文章的结构示例：

```mdx
# Your Article Title

Introduction

Your content here...

## Code Examples

// Example code block here...
```

**注意：** 你可以在博客文章中使用所有 MDX 功能，包括 React 组件。

6. **项目结构**

如需进一步了解 Next.js 的项目结构，请参阅 [Next.js](https://nextjs.org/docs/app/getting-started/project-structure) 文档。

7. **更多功能**

想添加更多动画组件吗？
可以查看 [Motion-Primitives](https://motion-primitives.com/)，了解更多动画组件和模板。如有其他需求，可以通过 [X](https://x.com/Ibelick) 给我发私信。

8.  **部署**

你可以将网站部署到任何支持 Next.js 的托管平台。若希望获得便捷的部署体验，可以考虑 Vercel：

[![使用 Vercel 部署](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fibelick%2Fnim&env=NEXT_PUBLIC_SITE_URL&project-name=nim&repository-name=nim&redirect-url=https%3A%2F%2Ftwitter.com%2Fibelick&demo-title=Nim&demo-description=Nim%20is%20a%20free%20and%20open-source%20minimal%20personal%20website%20template%20built%20with%20Next.js%2015%2C%20React%2019%2C%20and%20Motion-Primitives.&demo-url=https%3A%2F%2Fnim.vercel.app&demo-image=https%3A%2F%2Fraw.githubusercontent.com%2Fibelick%2Fnim%2Frefs%2Fheads%2Fmain%2F.github%2Fassets%2Freadme.png&teamSlug=ibelick)
