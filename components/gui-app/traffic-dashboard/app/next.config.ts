import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the runtime image only carries the server plus
  // the traced node_modules (see ../Dockerfile).
  output: "standalone",
  // Without this, Next walks up to the starter-kit's root package.json and
  // nests the standalone output under components/gui-app/traffic-dashboard/app/,
  // which would not match the Dockerfile's COPY paths. Pinning the root to this
  // directory keeps the layout identical for local and image builds.
  outputFileTracingRoot: path.join(import.meta.dirname),
  // The image is built in CI/from the CLI where no eslint config ships with the
  // component; type checking still runs and gates the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
