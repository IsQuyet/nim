/** @type {import('next').NextConfig} */
const allowedDevOrigins = process.env.ALLOWED_DEV_ORIGINS
  ?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ['@electric-sql/pglite'],
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: 6 * 1024 * 1024,
    },
  },
};

export default nextConfig;
