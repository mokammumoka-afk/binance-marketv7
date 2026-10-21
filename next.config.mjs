/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Public Binance market-data endpoints are called directly from the browser
  // (client-side) and from serverless API routes (server-side proxy/cache).
  // No secrets are required for public market data.
};

export default nextConfig;
