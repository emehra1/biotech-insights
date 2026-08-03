/**
 * Static export for GitHub Pages.
 *
 * `basePath` comes from configure-pages' `base_path` output, so the same build
 * works for a project site (/biotech-insights), a <user>.github.io repo ('') and
 * a custom domain ('') with no code change.
 *
 * Incompatible with `output: 'export'` and therefore absent by design: route
 * handlers, middleware, server actions, `revalidate`, `dynamic = 'force-dynamic'`,
 * and dynamic segments without `generateStaticParams`.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  // assetPrefix defaults to basePath; setting it again is redundant.
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
  },
};

export default nextConfig;
