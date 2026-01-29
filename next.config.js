/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    NEXT_PUBLIC_SCHEDULER_API_URL: process.env.SCHEDULER_API_URL,
  },
}

module.exports = nextConfig
