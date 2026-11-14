/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: 6 * 1024 * 1024,
    },
  },
};

export default nextConfig;
