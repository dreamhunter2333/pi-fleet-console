/** @param {import("next").NextConfig} config */
export function withFleetConfig(config) {
  if (process.env.PI_FLEET_STATIC_EXPORT !== "1") return config;
  return {
    ...config,
    output: "export",
    headers: undefined,
    env: {
      ...config.env,
      NEXT_PUBLIC_PI_FLEET: "1",
      NEXT_PUBLIC_FLEET_VERSION:
        process.env.PI_FLEET_VERSION ||
        config.env?.NEXT_PUBLIC_APP_VERSION ||
        "dev",
    },
  };
}
