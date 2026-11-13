import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    proxyClientMaxBodySize: '300mb',
    serverActions: {
      bodySizeLimit: '300mb',
      allowedOrigins: ['localhost:3000', '127.0.0.1:3000', '192.168.56.1:3000'],
    },
  },
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: 'http://127.0.0.1:8000/:path*',
      },
    ];
  },
};

export default nextConfig;

